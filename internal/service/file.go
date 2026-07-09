package service

import (
	"context"
	"fmt"
	"os"
	"sync"

	"mssh/internal/ssh"
	"mssh/pkg/event"
)

type FileService struct {
	sessions *SessionService
	eventBus EventBus
	mu       sync.Mutex
	tasks    map[string]context.CancelFunc
}

func NewFileService(sessions *SessionService, eventBus EventBus) *FileService {
	return &FileService{
		sessions: sessions,
		eventBus: eventBus,
		tasks:    make(map[string]context.CancelFunc),
	}
}

func (f *FileService) ListDir(sessionID int64, path string) ([]ssh.FileEntry, error) {
	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		return nil, fmt.Errorf("list dir: %w", err)
	}
	defer f.disconnect(connID)

	sftpClient, err := ssh.OpenSFTP(wrapper)
	if err != nil {
		return nil, fmt.Errorf("list dir: %w", err)
	}
	defer sftpClient.Close()

	return ssh.ListDir(sftpClient, path)
}

func (f *FileService) Upload(sessionID int64, localPath, remotePath string) (string, error) {
	taskID := generateTerminalID()

	_, cancel := context.WithCancel(context.Background())
	f.mu.Lock()
	f.tasks[taskID] = cancel
	f.mu.Unlock()

	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		cancel()
		f.removeTask(taskID)
		return "", fmt.Errorf("upload: %w", err)
	}

	go func() {
		defer f.disconnect(connID)
		defer cancel()
		defer f.removeTask(taskID)

		sftpClient, sftpErr := ssh.OpenSFTP(wrapper)
		if sftpErr != nil {
			f.eventBus.Emit(event.TransferError, event.TransferProgressPayload{TaskID: taskID})
			return
		}
		defer sftpClient.Close()

		size := f.getFileSize(localPath)
		uploadErr := ssh.UploadFile(sftpClient, localPath, remotePath, func(transferred, _ int64) {
			f.reportProgress(taskID, transferred, size)
		})

		if uploadErr != nil {
			f.eventBus.Emit(event.TransferError, event.TransferProgressPayload{TaskID: taskID})
			return
		}
		f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{TaskID: taskID, Percent: 100})
	}()

	return taskID, nil
}

func (f *FileService) Download(sessionID int64, remotePath, localPath string) (string, error) {
	taskID := generateTerminalID()

	_, cancel := context.WithCancel(context.Background())
	f.mu.Lock()
	f.tasks[taskID] = cancel
	f.mu.Unlock()

	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		cancel()
		f.removeTask(taskID)
		return "", fmt.Errorf("download: %w", err)
	}

	go func() {
		defer f.disconnect(connID)
		defer cancel()
		defer f.removeTask(taskID)

		sftpClient, sftpErr := ssh.OpenSFTP(wrapper)
		if sftpErr != nil {
			f.eventBus.Emit(event.TransferError, event.TransferProgressPayload{TaskID: taskID})
			return
		}
		defer sftpClient.Close()

		downloadErr := ssh.DownloadFile(sftpClient, remotePath, localPath, func(transferred, _ int64) {
			f.reportProgress(taskID, transferred, 0)
		})

		if downloadErr != nil {
			f.eventBus.Emit(event.TransferError, event.TransferProgressPayload{TaskID: taskID})
			return
		}
		f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{TaskID: taskID, Percent: 100})
	}()

	return taskID, nil
}

func (f *FileService) CancelTransfer(taskID string) error {
	f.mu.Lock()
	cancel, ok := f.tasks[taskID]
	if !ok {
		f.mu.Unlock()
		return fmt.Errorf("task %s not found", taskID)
	}
	delete(f.tasks, taskID)
	f.mu.Unlock()
	cancel()
	return nil
}

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
	defer sftpClient.Close()

	return ssh.RemoveFile(sftpClient, path)
}

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
	defer sftpClient.Close()

	return ssh.Mkdir(sftpClient, path)
}

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
	defer sftpClient.Close()

	return ssh.Rename(sftpClient, oldPath, newPath)
}

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

func (f *FileService) reportProgress(taskID string, transferred, total int64) {
	percent := float64(0)
	if total > 0 {
		percent = float64(transferred) / float64(total) * 100
	}
	f.eventBus.Emit(event.TransferProgress, event.TransferProgressPayload{
		TaskID:  taskID,
		Percent: percent,
	})
}

func (f *FileService) getFileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}
