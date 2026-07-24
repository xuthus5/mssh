package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/xuthus5/mssh/internal/fsutil"
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
	return f.startTransfer(transferSpec{direction: "upload", sessionID: sessionID, source: localPath, target: remotePath, run: f.runUpload})
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
	return f.startTransfer(transferSpec{direction: "download", sessionID: sessionID, source: remotePath, target: localPath, run: f.runDownload})
}

type transferSpec struct {
	direction string
	sessionID int64
	source    string
	target    string
	run       func(transferExecution)
}

type transferExecution struct {
	ctx    context.Context
	taskID string
	client *ssh.SFTPClient
	source string
	target string
}

type transferWorker struct {
	ctx     context.Context
	cancel  context.CancelFunc
	taskID  string
	connID  string
	wrapper *ssh.ClientWrapper
	spec    transferSpec
}

func (f *FileService) startTransfer(spec transferSpec) (string, error) {
	taskID := generateFileTaskID()
	ctx, cancel := context.WithCancel(context.Background())
	if err := f.registerTask(taskID, spec.sessionID, cancel); err != nil {
		cancel()
		return "", err
	}
	if err := f.createTransfer(taskID, spec.sessionID, spec.direction, spec.source, spec.target); err != nil {
		f.releaseRegisteredTask(taskID, cancel)
		return "", err
	}
	wrapper, connID, err := f.connect(ctx, spec.sessionID)
	if err != nil {
		f.releaseRegisteredTask(taskID, cancel)
		status := "failed"
		if transferAborted(ctx, err) {
			status = "cancelled"
		}
		f.finishTransfer(taskID, status, err.Error())
		return "", fmt.Errorf("%s: %w", spec.direction, err)
	}
	worker := transferWorker{ctx: ctx, cancel: cancel, taskID: taskID, connID: connID, wrapper: wrapper, spec: spec}
	if !f.attachTaskCloser(taskID, ctx, wrapper.Close) {
		return "", f.abortTransferStart(worker)
	}
	f.recordStart(taskID)
	f.launchTransfer(worker)
	return taskID, nil
}

func (f *FileService) releaseRegisteredTask(taskID string, cancel context.CancelFunc) {
	cancel()
	f.removeTask(taskID)
	f.workers.Done()
}

func (f *FileService) abortTransferStart(worker transferWorker) error {
	abortErr := worker.ctx.Err()
	if abortErr == nil {
		abortErr = context.Canceled
	}
	if err := worker.wrapper.Close(); err != nil {
		f.logger.Debug("close cancelled transfer transport failed", "taskID", worker.taskID, "error", err)
	}
	f.disconnect(worker.connID)
	f.releaseRegisteredTask(worker.taskID, worker.cancel)
	f.finishTransfer(worker.taskID, "cancelled", abortErr.Error())
	return abortErr
}

func (f *FileService) launchTransfer(worker transferWorker) {
	go func() {
		defer f.workers.Done()
		defer f.disconnect(worker.connID)
		defer worker.cancel()
		defer f.removeTask(worker.taskID)
		defer f.clearStart(worker.taskID)
		sftpClient, sftpErr := ssh.OpenSFTP(worker.wrapper)
		if sftpErr != nil {
			if transferAborted(worker.ctx, sftpErr) {
				f.emitTransferCancelled(worker.taskID)
				return
			}
			f.emitTransferError(worker.taskID, sftpErr)
			return
		}
		defer func() { _ = sftpClient.Close() }()
		worker.spec.run(transferExecution{ctx: worker.ctx, taskID: worker.taskID, client: sftpClient, source: worker.spec.source, target: worker.spec.target})
	}()
}

func (f *FileService) runUpload(transfer transferExecution) {
	temporaryPath := transfer.target + ".mssh-partial-" + transfer.taskID
	size := f.getFileSize(transfer.source)
	uploadErr := ssh.UploadFileContext(transfer.ctx, transfer.client, transfer.source, temporaryPath, func(transferred, _ int64) {
		f.reportProgress(transfer.taskID, transferred, size)
	})
	if uploadErr != nil {
		_ = ssh.RemoveFile(transfer.client, temporaryPath)
		if transferAborted(transfer.ctx, uploadErr) {
			f.emitTransferCancelled(transfer.taskID)
			return
		}
		f.emitTransferError(transfer.taskID, uploadErr)
		return
	}
	if renameErr := ssh.Rename(transfer.client, temporaryPath, transfer.target); renameErr != nil {
		_ = ssh.RemoveFile(transfer.client, temporaryPath)
		if transferAborted(transfer.ctx, renameErr) {
			f.emitTransferCancelled(transfer.taskID)
			return
		}
		f.emitTransferError(transfer.taskID, renameErr)
		return
	}
	f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{TaskID: transfer.taskID, Status: "completed", Transferred: size, Total: size, Percent: 100})
	f.finishTransfer(transfer.taskID, "completed", "")
}

func (f *FileService) runDownload(transfer transferExecution) {
	size := f.getRemoteFileSize(transfer.client, transfer.source)
	partialPath := downloadPartialPath(transfer.target, transfer.taskID)
	downloadErr := ssh.DownloadFileContext(transfer.ctx, transfer.client, transfer.source, partialPath, func(transferred, _ int64) {
		f.reportProgress(transfer.taskID, transferred, size)
	})
	if downloadErr != nil {
		_ = os.Remove(partialPath)
		if transferAborted(transfer.ctx, downloadErr) {
			f.emitTransferCancelled(transfer.taskID)
			return
		}
		f.emitTransferError(transfer.taskID, downloadErr)
		return
	}
	if renameErr := fsutil.ReplaceFile(partialPath, transfer.target); renameErr != nil {
		_ = os.Remove(partialPath)
		if transferAborted(transfer.ctx, renameErr) {
			f.emitTransferCancelled(transfer.taskID)
			return
		}
		f.emitTransferError(transfer.taskID, fmt.Errorf("finalize download: %w", renameErr))
		return
	}
	f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{TaskID: transfer.taskID, Status: "completed", Transferred: size, Total: size, Percent: 100})
	f.finishTransfer(transfer.taskID, "completed", "")
}

func downloadPartialPath(localPath, taskID string) string {
	return localPath + ".mssh-partial-" + taskID
}

// CancelTransfer cancels an in-progress file transfer.
func (f *FileService) CancelTransfer(taskID string) error {
	if strings.TrimSpace(taskID) == "" {
		return fmt.Errorf("invalid task id")
	}
	f.logger.Info("cancelling transfer", "taskID", taskID)
	f.mu.Lock()
	cancellation, ok := f.cancelTaskLocked(taskID)
	if !ok {
		f.mu.Unlock()
		return fmt.Errorf("task %s not found", taskID)
	}
	f.mu.Unlock()
	f.closeCancelledTask(cancellation)
	return nil
}

func (f *FileService) CancelAll() {
	f.mu.Lock()
	cancellations := f.cancellationSnapshotLocked()
	f.mu.Unlock()
	f.closeCancelledTasks(cancellations)
}

func transferAborted(ctx context.Context, err error) bool {
	if ctx != nil && ctx.Err() != nil {
		return true
	}
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}
