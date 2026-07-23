package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/pkg/event"
)

func (f *FileService) Upload(sessionID int64, localPath, remotePath string) (string, error) {
	cleanedLocal, err := validateLocalTransferPath(localPath)
	if err != nil {
		return "", fmt.Errorf("upload: %w", err)
	}
	if err := validateRemotePath(remotePath); err != nil {
		return "", fmt.Errorf("upload: %w", err)
	}
	localPath = cleanedLocal
	f.logger.Info("uploading file", "sessionID", sessionID, "localPath", localPath, "remotePath", remotePath)
	return f.startTransfer("upload", sessionID, localPath, remotePath, func(ctx context.Context, taskID string, client *ssh.SFTPClient) {
		f.runUpload(ctx, taskID, client, localPath, remotePath)
	})
}

func (f *FileService) Download(sessionID int64, remotePath, localPath string) (string, error) {
	if err := validateRemotePath(remotePath); err != nil {
		return "", fmt.Errorf("download: %w", err)
	}
	cleanedLocal, err := validateLocalTransferPath(localPath)
	if err != nil {
		return "", fmt.Errorf("download: %w", err)
	}
	localPath = cleanedLocal
	f.logger.Info("downloading file", "sessionID", sessionID, "remotePath", remotePath, "localPath", localPath)
	return f.startTransfer("download", sessionID, remotePath, localPath, func(ctx context.Context, taskID string, client *ssh.SFTPClient) {
		f.runDownload(ctx, taskID, client, remotePath, localPath)
	})
}

func (f *FileService) startTransfer(direction string, sessionID int64, source, target string, run func(context.Context, string, *ssh.SFTPClient)) (string, error) {
	taskID := generateFileTaskID()
	if err := f.createTransfer(taskID, sessionID, direction, source, target); err != nil {
		return "", err
	}
	ctx, cancel := context.WithCancel(context.Background())
	f.mu.Lock()
	f.tasks[taskID] = cancel
	f.mu.Unlock()
	wrapper, connID, err := f.connect(sessionID)
	if err != nil {
		cancel()
		f.removeTask(taskID)
		f.finishTransfer(taskID, "failed", err.Error())
		return "", fmt.Errorf("%s: %w", direction, err)
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
		run(ctx, taskID, sftpClient)
	}()
	return taskID, nil
}

func (f *FileService) runUpload(ctx context.Context, taskID string, sftpClient *ssh.SFTPClient, localPath, remotePath string) {
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
	f.finishTransfer(taskID, "completed", "")
}

func (f *FileService) runDownload(ctx context.Context, taskID string, sftpClient *ssh.SFTPClient, remotePath, localPath string) {
	size := f.getRemoteFileSize(sftpClient, remotePath)
	partialPath := localPath + ".partial"
	downloadErr := ssh.DownloadFileContext(ctx, sftpClient, remotePath, partialPath, func(transferred, _ int64) {
		f.reportProgress(taskID, transferred, size)
	})
	if downloadErr != nil {
		_ = os.Remove(partialPath)
		if errors.Is(downloadErr, context.Canceled) {
			f.emitTransferCancelled(taskID)
			return
		}
		f.emitTransferError(taskID, downloadErr)
		return
	}
	if renameErr := os.Rename(partialPath, localPath); renameErr != nil {
		_ = os.Remove(partialPath)
		f.emitTransferError(taskID, fmt.Errorf("finalize download: %w", renameErr))
		return
	}
	f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{TaskID: taskID, Status: "completed", Transferred: size, Total: size, Percent: 100})
	f.finishTransfer(taskID, "completed", "")
}

// CancelTransfer cancels an in-progress file transfer.
func (f *FileService) CancelTransfer(taskID string) error {
	if strings.TrimSpace(taskID) == "" {
		return fmt.Errorf("invalid task id")
	}
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

func (f *FileService) CancelAll() {
	f.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(f.tasks))
	for _, cancel := range f.tasks {
		cancels = append(cancels, cancel)
	}
	f.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}
