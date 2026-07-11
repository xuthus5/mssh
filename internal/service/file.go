package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"mssh/internal/ssh"
	"mssh/pkg/event"
)

// FileService manages SFTP file operations with progress tracking.
type FileService struct {
	sessions *SessionService
	eventBus EventBus
	mu       sync.Mutex
	tasks    map[string]context.CancelFunc
	progress sync.Mutex
	startsAt map[string]time.Time
	logger   *slog.Logger
}

// NewFileService creates a new FileService.
func NewFileService(sessions *SessionService, eventBus EventBus, logger *slog.Logger) *FileService {
	return &FileService{
		sessions: sessions,
		eventBus: eventBus,
		tasks:    make(map[string]context.CancelFunc),
		startsAt: make(map[string]time.Time),
		logger:   logger,
	}
}

// ListDir lists remote directory entries via SFTP.
func (f *FileService) ListDir(sessionID int64, path string) ([]ssh.FileEntry, error) {
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
func (f *FileService) Upload(sessionID int64, localPath, remotePath string) (string, error) {
	f.logger.Info("uploading file", "sessionID", sessionID, "localPath", localPath, "remotePath", remotePath)
	taskID := generateFileTaskID()

	ctx, cancel := context.WithCancel(context.Background())
	f.mu.Lock()
	f.tasks[taskID] = cancel
	f.mu.Unlock()

	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		cancel()
		f.removeTask(taskID)
		f.logger.Error("upload failed", "sessionID", sessionID, "error", err)
		return "", fmt.Errorf("upload: %w", err)
	}

	f.recordStart(taskID)

	go func() {
		defer f.disconnect(connID)
		defer cancel()
		defer f.removeTask(taskID)
		defer f.clearStart(taskID)

		sftpClient, sftpErr := ssh.OpenSFTP(wrapper)
		if sftpErr != nil {
			f.emitTransferError(taskID, sftpErr)
			return
		}
		defer func() { _ = sftpClient.Close() }()

		temporaryPath := remotePath + ".mssh-partial-" + taskID
		size := f.getFileSize(localPath)
		uploadErr := ssh.UploadFileContext(ctx, sftpClient, localPath, temporaryPath, func(transferred, _ int64) {
			f.reportProgress(taskID, transferred, size)
		})

		if uploadErr != nil {
			_ = ssh.RemoveFile(sftpClient, temporaryPath)
			if errors.Is(uploadErr, context.Canceled) {
				f.emitTransferCancelled(taskID)
				return
			}
			f.emitTransferError(taskID, uploadErr)
			return
		}
		if renameErr := ssh.Rename(sftpClient, temporaryPath, remotePath); renameErr != nil {
			_ = ssh.RemoveFile(sftpClient, temporaryPath)
			f.emitTransferError(taskID, renameErr)
			return
		}
		f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{TaskID: taskID, Status: "completed", Transferred: size, Total: size, Percent: 100})
	}()

	return taskID, nil
}

// Download starts an async file download and returns a task ID.
func (f *FileService) Download(sessionID int64, remotePath, localPath string) (string, error) {
	f.logger.Info("downloading file", "sessionID", sessionID, "remotePath", remotePath, "localPath", localPath)
	taskID := generateFileTaskID()

	ctx, cancel := context.WithCancel(context.Background())
	f.mu.Lock()
	f.tasks[taskID] = cancel
	f.mu.Unlock()

	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		cancel()
		f.removeTask(taskID)
		return "", fmt.Errorf("download: %w", err)
	}

	f.recordStart(taskID)

	go func() {
		defer f.disconnect(connID)
		defer cancel()
		defer f.removeTask(taskID)
		defer f.clearStart(taskID)

		sftpClient, sftpErr := ssh.OpenSFTP(wrapper)
		if sftpErr != nil {
			f.emitTransferError(taskID, sftpErr)
			return
		}
		defer func() { _ = sftpClient.Close() }()

		size := f.getRemoteFileSize(sftpClient, remotePath)
		partialPath := localPath + ".partial"
		downloadErr := ssh.DownloadFileContext(ctx, sftpClient, remotePath, partialPath, func(transferred, _ int64) {
			f.reportProgress(taskID, transferred, size)
		})

		if downloadErr != nil {
			if errors.Is(downloadErr, context.Canceled) {
				f.emitTransferCancelled(taskID)
				return
			}
			f.emitTransferError(taskID, downloadErr)
			return
		}
		if renameErr := os.Rename(partialPath, localPath); renameErr != nil {
			f.emitTransferError(taskID, fmt.Errorf("finalize download: %w", renameErr))
			return
		}
		f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{TaskID: taskID, Status: "completed", Transferred: size, Total: size, Percent: 100})
	}()

	return taskID, nil
}

// CancelTransfer cancels an in-progress file transfer.
func (f *FileService) CancelTransfer(taskID string) error {
	f.logger.Info("cancelling transfer", "taskID", taskID)
	f.mu.Lock()
	cancel, ok := f.tasks[taskID]
	if !ok {
		f.mu.Unlock()
		return fmt.Errorf("task %s not found", taskID)
	}
	f.mu.Unlock()
	cancel()
	return nil
}

// Delete removes a remote file via SFTP.
func (f *FileService) Delete(sessionID int64, path string) error {
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
	ctx := context.Background()
	connID, err := f.sessions.Connect(ctx, sessionID)
	if err != nil {
		return nil, "", err
	}
	wrapper, err := f.sessions.GetClientWrapper(connID)
	if err != nil {
		_ = f.sessions.Disconnect(connID)
		return nil, "", err
	}
	return wrapper, connID, nil
}

func (f *FileService) disconnect(connID string) {
	_ = f.sessions.Disconnect(connID)
}

func (f *FileService) removeTask(taskID string) {
	f.mu.Lock()
	delete(f.tasks, taskID)
	f.mu.Unlock()
}

func (f *FileService) recordStart(taskID string) {
	f.progress.Lock()
	f.startsAt[taskID] = time.Now()
	f.progress.Unlock()
}

func (f *FileService) clearStart(taskID string) {
	f.progress.Lock()
	delete(f.startsAt, taskID)
	f.progress.Unlock()
}

// reportProgress calculates percent, speed, and ETA, then emits a progress event.
func (f *FileService) reportProgress(taskID string, transferred, total int64) {
	percent := float64(0)
	if total > 0 {
		percent = float64(transferred) / float64(total) * 100
	}

	var speed int64
	var eta int64
	f.progress.Lock()
	start, ok := f.startsAt[taskID]
	f.progress.Unlock()
	if ok {
		elapsed := time.Since(start).Seconds()
		if elapsed > 0 {
			speed = int64(float64(transferred) / elapsed)
			if speed > 0 && total > 0 {
				remaining := total - transferred
				eta = int64(float64(remaining) / float64(speed))
			}
		}
	}

	f.eventBus.Emit(event.TransferProgress, event.TransferProgressPayload{
		TaskID:      taskID,
		Status:      "running",
		Transferred: transferred,
		Total:       total,
		Percent:     percent,
		Speed:       speed,
		ETA:         eta,
	})
}

// emitTransferError emits a transfer error event with the error message.
func (f *FileService) emitTransferError(taskID string, err error) {
	f.eventBus.Emit(event.TransferError, event.TransferErrorPayload{
		TaskID: taskID,
		Status: "failed",
		Error:  err.Error(),
	})
}

func (f *FileService) emitTransferCancelled(taskID string) {
	f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{
		TaskID: taskID,
		Status: "cancelled",
	})
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
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("file-%x", b)
}
