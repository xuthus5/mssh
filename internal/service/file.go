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
	sessions             *SessionService
	eventBus             EventBus
	mu                   sync.Mutex
	closeMu              sync.Mutex
	tasks                map[string]context.CancelFunc
	taskClosers          map[string]func() error
	taskSessions         map[string]int64
	taskRuntimes         map[string]*transferTaskRuntime
	transferSlots        chan struct{}
	maxQueuedTransfers   int
	workers              sync.WaitGroup
	operationWG          sync.WaitGroup
	stopping             bool
	shuttingDown         bool
	progress             sync.Mutex
	startsAt             map[string]time.Time
	lastProgressPersist  map[string]time.Time
	lastProgressBytes    map[string]int64
	finalizationMu       sync.Mutex
	pendingFinalizations map[string]transferFinalization
	finalizationJournal  *transferFinalizationJournalStore
	transferOperations   fileTransferOperations
	logger               *slog.Logger
	db                   *sql.DB
}

const (
	transferProgressPersistMinInterval = 200 * time.Millisecond
	transferProgressPersistMinDelta    = 256 * 1024 // 256 KiB
)

var sftpMetadataOperationTimeout = 15 * time.Second

type FileServiceOption func(*FileService)

func WithTransferDB(db *sql.DB) FileServiceOption {
	return func(service *FileService) { service.db = db }
}

func WithTransferJournalDataDir(dataDir string) FileServiceOption {
	return func(service *FileService) {
		service.finalizationJournal = newTransferFinalizationJournalStore(dataDir)
	}
}

// NewFileService creates a new FileService.
func NewFileService(sessions *SessionService, eventBus EventBus, logger *slog.Logger, options ...FileServiceOption) *FileService {
	service := &FileService{
		sessions:             sessions,
		eventBus:             eventBus,
		tasks:                make(map[string]context.CancelFunc),
		taskClosers:          make(map[string]func() error),
		taskSessions:         make(map[string]int64),
		taskRuntimes:         make(map[string]*transferTaskRuntime),
		transferSlots:        make(chan struct{}, defaultMaxConcurrentTransfers),
		maxQueuedTransfers:   defaultMaxQueuedTransfers,
		startsAt:             make(map[string]time.Time),
		lastProgressPersist:  make(map[string]time.Time),
		lastProgressBytes:    make(map[string]int64),
		pendingFinalizations: make(map[string]transferFinalization),
		transferOperations:   defaultFileTransferOperations(),
		logger:               logger,
	}
	for _, option := range options {
		option(service)
	}
	service.loadTransferFinalizationJournal()
	return service
}

func (f *FileService) ListTransfers() ([]model.TransferJob, error) {
	finish, err := f.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if f.db == nil {
		return []model.TransferJob{}, nil
	}
	f.reconcilePendingTransferFinalizations()
	jobs, err := store.ListTransferJobs(f.db)
	if err != nil {
		return nil, err
	}
	return f.overlayPendingTransferFinalizations(jobs), nil
}

// ListDir lists remote directory entries via SFTP.
func (f *FileService) ListDir(sessionID int64, path string) ([]ssh.FileEntry, error) {
	if err := validateRemotePath(path); err != nil {
		return nil, fmt.Errorf("list dir: %w", err)
	}
	finish, err := f.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	f.logger.Info("listing directory", "sessionID", sessionID, "path", path)
	wrapper, connID, err := f.connect(context.Background(), sessionID)
	if err != nil {
		f.logger.Error("list dir failed", "sessionID", sessionID, "error", err)
		return nil, fmt.Errorf("list dir: %w", err)
	}
	defer f.disconnect(connID)
	deadline, err := setSFTPMetadataDeadline(wrapper)
	if err != nil {
		return nil, fmt.Errorf("list dir: %w", err)
	}

	sftpClient, err := ssh.OpenSFTP(wrapper)
	if err != nil {
		f.logger.Error("list dir failed", "sessionID", sessionID, "error", err)
		return nil, sftpMetadataError("list dir", deadline, err)
	}
	defer func() { _ = sftpClient.Close() }()

	entries, err := ssh.ListDir(sftpClient, path)
	if err != nil {
		return nil, sftpMetadataError("list dir", deadline, err)
	}
	return entries, nil
}

// connect establishes a temporary SSH connection for a file operation.
func (f *FileService) connect(ctx context.Context, sessionID int64) (*ssh.ClientWrapper, string, error) {
	if sessionID <= 0 {
		return nil, "", fmt.Errorf("invalid session id")
	}
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

func (f *FileService) getFileSize(localPath string) int64 {
	info, err := os.Stat(localPath)
	if err != nil {
		return 0
	}
	return info.Size()
}

// getRemoteFileSize queries the remote file size via SFTP Stat.
func (f *FileService) getRemoteFileSize(client *ssh.SFTPClient, remotePath string) int64 {
	size, err := f.transferOperations.remoteFileSize(client, remotePath)
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
