package service

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
)

// FileService manages SFTP file operations with progress tracking.
type FileService struct {
	sessions            *SessionService
	eventBus            EventBus
	mu                  sync.Mutex
	tasks               map[string]context.CancelFunc
	taskSessions        map[string]int64
	progress            sync.Mutex
	startsAt            map[string]time.Time
	lastProgressPersist map[string]time.Time
	lastProgressBytes   map[string]int64
	logger              *slog.Logger
	db                  *sql.DB
}

const (
	transferProgressPersistMinInterval = 200 * time.Millisecond
	transferProgressPersistMinDelta    = 256 * 1024 // 256 KiB
)

type FileServiceOption func(*FileService)

func WithTransferDB(db *sql.DB) FileServiceOption {
	return func(service *FileService) { service.db = db }
}

// NewFileService creates a new FileService.
func NewFileService(sessions *SessionService, eventBus EventBus, logger *slog.Logger, options ...FileServiceOption) *FileService {
	service := &FileService{
		sessions:            sessions,
		eventBus:            eventBus,
		tasks:               make(map[string]context.CancelFunc),
		taskSessions:        make(map[string]int64),
		startsAt:            make(map[string]time.Time),
		lastProgressPersist: make(map[string]time.Time),
		lastProgressBytes:   make(map[string]int64),
		logger:              logger,
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (f *FileService) ListTransfers() ([]model.TransferJob, error) {
	if f.db == nil {
		return []model.TransferJob{}, nil
	}
	if err := store.MarkInterruptedTransfers(f.db); err != nil {
		return nil, fmt.Errorf("mark interrupted transfers: %w", err)
	}
	return store.ListTransferJobs(f.db)
}

// ListDir lists remote directory entries via SFTP.
func (f *FileService) ListDir(sessionID int64, path string) ([]ssh.FileEntry, error) {
	if err := validateRemotePath(path); err != nil {
		return nil, fmt.Errorf("list dir: %w", err)
	}
	f.logger.Info("listing directory", "sessionID", sessionID, "path", path)
	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		f.logger.Error("list dir failed", "sessionID", sessionID, "error", err)
		return nil, fmt.Errorf("list dir: %w", err)
	}
	defer f.disconnect(connID)

	sftpClient, err := ssh.OpenSFTP(wrapper)
	if err != nil {
		f.logger.Error("list dir failed", "sessionID", sessionID, "error", err)
		return nil, fmt.Errorf("list dir: %w", err)
	}
	defer func() { _ = sftpClient.Close() }()

	return ssh.ListDir(sftpClient, path)
}

// Upload starts an async file upload and returns a task ID.
func (f *FileService) Delete(sessionID int64, path string) error {
	if err := validateRemotePath(path); err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	defer f.disconnect(connID)

	sftpClient, err := ssh.OpenSFTP(wrapper)
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	defer func() { _ = sftpClient.Close() }()

	return ssh.RemoveFile(sftpClient, path)
}

// Mkdir creates a remote directory via SFTP.
func (f *FileService) Mkdir(sessionID int64, path string) error {
	if err := validateRemotePath(path); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	defer f.disconnect(connID)

	sftpClient, err := ssh.OpenSFTP(wrapper)
	if err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	defer func() { _ = sftpClient.Close() }()

	return ssh.Mkdir(sftpClient, path)
}

// Rename renames a remote file via SFTP.
func (f *FileService) Rename(sessionID int64, oldPath, newPath string) error {
	if err := validateRemotePath(oldPath); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	if err := validateRemotePath(newPath); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	defer f.disconnect(connID)

	sftpClient, err := ssh.OpenSFTP(wrapper)
	if err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	defer func() { _ = sftpClient.Close() }()

	return ssh.Rename(sftpClient, oldPath, newPath)
}

// connect establishes a temporary SSH connection for a file operation.
func (f *FileService) connect(sessionID int64) (*ssh.ClientWrapper, string, error) {
	if sessionID <= 0 {
		return nil, "", fmt.Errorf("invalid session id")
	}
	ctx := context.Background()
	connID, err := f.sessions.connect(ctx, sessionID, false)
	if err != nil {
		return nil, "", err
	}
	wrapper, err := f.sessions.GetClientWrapper(connID)
	if err != nil {
		_ = f.sessions.disconnect(connID, false)
		return nil, "", err
	}
	return wrapper, connID, nil
}

func (f *FileService) disconnect(connID string) {
	_ = f.sessions.disconnect(connID, false)
}

func (f *FileService) removeTask(taskID string) {
	f.mu.Lock()
	delete(f.tasks, taskID)
	delete(f.taskSessions, taskID)
	f.mu.Unlock()
}

func (f *FileService) createTransfer(taskID string, sessionID int64, direction, sourcePath, targetPath string) error {
	if f.db == nil {
		return nil
	}
	session, err := store.GetSession(f.db, sessionID)
	if err != nil {
		return fmt.Errorf("create transfer: %w", err)
	}
	job := model.TransferJob{ID: taskID, SessionID: sessionID, SessionName: session.Name, Direction: direction, SourcePath: sourcePath, TargetPath: targetPath, Status: "queued", StartedAt: time.Now()}
	if err := store.CreateTransferJob(f.db, job); err != nil {
		return err
	}
	return nil
}

func (f *FileService) finishTransfer(taskID, status, errorMessage string) {
	if f.db == nil {
		return
	}
	if err := store.FinishTransferJob(f.db, taskID, status, errorMessage); err != nil {
		f.logger.Error("persist transfer completion failed", "taskID", taskID, "error", err)
	}
}

func (f *FileService) getFileSize(localPath string) int64 {
	info, err := os.Stat(localPath)
	if err != nil {
		return 0
	}
	return info.Size()
}

// getRemoteFileSize queries the remote file size via SFTP Stat.
func (f *FileService) getRemoteFileSize(client *ssh.SFTPClient, remotePath string) int64 {
	size, err := ssh.RemoteFileSize(client, remotePath)
	if err != nil {
		f.logger.Debug("get remote file size failed", "path", remotePath, "error", err)
		return 0
	}
	return size
}

// generateFileTaskID generates a unique task ID with a file- prefix.
func generateFileTaskID() string {
	return "file-" + uuid.NewString()
}
