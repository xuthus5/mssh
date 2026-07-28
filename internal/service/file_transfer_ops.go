package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/ssh"
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
	ctx     context.Context
	taskID  string
	client  *ssh.SFTPClient
	source  string
	target  string
	runtime *transferTaskRuntime
}

type transferWorker struct {
	ctx     context.Context
	cancel  context.CancelFunc
	taskID  string
	connID  string
	wrapper *ssh.ClientWrapper
	spec    transferSpec
	runtime *transferTaskRuntime
}

func (f *FileService) startTransfer(spec transferSpec) (string, error) {
	finish, err := f.beginOperation()
	if err != nil {
		return "", err
	}
	defer finish()
	if spec.direction == "upload" {
		cleanedSource, validateErr := validateUploadSource(spec.source)
		if validateErr != nil {
			return "", fmt.Errorf("upload: %w", validateErr)
		}
		spec.source = cleanedSource
	}
	taskID := generateFileTaskID()
	ctx, cancel := context.WithCancel(context.Background())
	registration := transferRegistration{taskID: taskID, spec: spec, ctx: ctx, cancel: cancel}
	runtime, err := f.prepareQueuedTransfer(registration)
	if err != nil {
		return "", fmt.Errorf("%s: %w", spec.direction, err)
	}
	wrapper, connID, err := f.connect(ctx, spec.sessionID)
	if err != nil {
		outcome := transferOutcomeForError(ctx, err)
		f.releaseTransferSlot()
		f.resolveTransfer(runtime, taskID, func() transferOutcome { return outcome })
		f.releaseRegisteredTask(taskID, cancel)
		return "", fmt.Errorf("%s: %w", spec.direction, err)
	}
	worker := transferWorker{
		ctx: ctx, cancel: cancel, taskID: taskID, connID: connID,
		wrapper: wrapper, spec: spec, runtime: runtime,
	}
	if !f.attachTaskCloser(taskID, ctx, wrapper.Close) {
		return "", f.abortTransferStart(worker)
	}
	if !runtime.publish() {
		return "", f.abortTransferStart(worker)
	}
	f.recordStart(taskID)
	f.launchTransfer(worker)
	return taskID, nil
}

func (f *FileService) releaseRegisteredTask(taskID string, cancel context.CancelFunc) {
	runtime := f.taskRuntime(taskID)
	cancel()
	f.removeTask(taskID)
	f.workers.Done()
	runtime.signalDone()
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
	f.releaseTransferSlot()
	f.resolveTransfer(worker.runtime, worker.taskID, func() transferOutcome {
		return cancelledTransferOutcome()
	})
	f.releaseRegisteredTask(worker.taskID, worker.cancel)
	return abortErr
}

func (f *FileService) launchTransfer(worker transferWorker) {
	go func() {
		defer worker.runtime.signalDone()
		defer f.workers.Done()
		defer f.removeTask(worker.taskID)
		defer f.releaseTransferSlot()
		defer f.disconnect(worker.connID)
		defer worker.cancel()
		defer f.clearStart(worker.taskID)
		sftpClient, sftpErr := ssh.OpenSFTP(worker.wrapper)
		if sftpErr != nil {
			outcome := transferOutcomeForError(worker.ctx, sftpErr)
			f.resolveTransfer(worker.runtime, worker.taskID, func() transferOutcome { return outcome })
			return
		}
		defer func() { _ = sftpClient.Close() }()
		worker.spec.run(transferExecution{
			ctx: worker.ctx, taskID: worker.taskID, client: sftpClient,
			source: worker.spec.source, target: worker.spec.target, runtime: worker.runtime,
		})
	}()
}

func (f *FileService) runUpload(transfer transferExecution) {
	temporaryPath := transfer.target + ".mssh-partial-" + transfer.taskID
	size := f.getFileSize(transfer.source)
	partialCreated, uploadErr := f.transferOperations.upload(transfer.ctx, transfer.client, transfer.source, temporaryPath, func(transferred, _ int64) {
		f.reportProgress(transfer.taskID, transferred, size)
	})
	if uploadErr != nil {
		cleanupErr := f.cleanupRemotePartialIfOwned(transfer.client, temporaryPath, partialCreated)
		outcome := transferFailureOutcome(transfer.ctx, uploadErr, cleanupErr)
		f.resolveTransferWithCancellation(transfer.runtime, transfer.taskID,
			func() transferOutcome { return outcome },
			func() transferOutcome { return cancelledTransferOutcome(cleanupErr) })
		return
	}
	if !partialCreated {
		f.resolveTransfer(transfer.runtime, transfer.taskID, func() transferOutcome {
			return failedTransferOutcome(errors.New("upload completed without owning remote partial"))
		})
		return
	}
	f.resolveTransferWithCancellation(transfer.runtime, transfer.taskID, func() transferOutcome {
		if transfer.ctx.Err() != nil {
			return cancelledTransferOutcome(f.cleanupRemotePartial(transfer.client, temporaryPath))
		}
		if err := f.transferOperations.renameRemote(transfer.client, temporaryPath, transfer.target); err != nil {
			cleanupErr := f.cleanupRemotePartial(transfer.client, temporaryPath)
			return failedTransferOutcome(errors.Join(err, cleanupErr))
		}
		return completedTransferOutcome(size, size)
	}, func() transferOutcome {
		return cancelledTransferOutcome(f.cleanupRemotePartial(transfer.client, temporaryPath))
	})
}

func (f *FileService) runDownload(transfer transferExecution) {
	size := f.getRemoteFileSize(transfer.client, transfer.source)
	partialPath := downloadPartialPath(transfer.target, transfer.taskID)
	partialCreated, downloadErr := f.transferOperations.download(transfer.ctx, transfer.client, transfer.source, partialPath, func(transferred, _ int64) {
		f.reportProgress(transfer.taskID, transferred, size)
	})
	if downloadErr != nil {
		cleanupErr := f.cleanupLocalPartialIfOwned(partialPath, partialCreated)
		outcome := transferFailureOutcome(transfer.ctx, downloadErr, cleanupErr)
		f.resolveTransferWithCancellation(transfer.runtime, transfer.taskID,
			func() transferOutcome { return outcome },
			func() transferOutcome { return cancelledTransferOutcome(cleanupErr) })
		return
	}
	if !partialCreated {
		f.resolveTransfer(transfer.runtime, transfer.taskID, func() transferOutcome {
			return failedTransferOutcome(errors.New("download completed without owning local partial"))
		})
		return
	}
	f.resolveTransferWithCancellation(transfer.runtime, transfer.taskID, func() transferOutcome {
		if transfer.ctx.Err() != nil {
			return cancelledTransferOutcome(f.cleanupLocalPartial(partialPath))
		}
		if err := f.transferOperations.replaceLocal(partialPath, transfer.target); err != nil {
			cleanupErr := f.cleanupLocalPartial(partialPath)
			return failedTransferOutcome(errors.Join(fmt.Errorf("finalize download: %w", err), cleanupErr))
		}
		return completedTransferOutcome(size, size)
	}, func() transferOutcome {
		return cancelledTransferOutcome(f.cleanupLocalPartial(partialPath))
	})
}

func downloadPartialPath(localPath, taskID string) string {
	return localPath + ".mssh-partial-" + taskID
}

// CancelTransfer cancels an in-progress file transfer.
func (f *FileService) CancelTransfer(taskID string) error {
	if strings.TrimSpace(taskID) == "" {
		return fmt.Errorf("invalid task id")
	}
	finish, err := f.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	f.logger.Info("cancelling transfer", "taskID", taskID)
	f.mu.Lock()
	cancellation, ok := f.cancelTaskLocked(taskID)
	if !ok {
		f.mu.Unlock()
		return fmt.Errorf("task %s not found", taskID)
	}
	f.mu.Unlock()
	_ = f.cancelRegisteredTransfer(cancellation)
	f.waitForTransfer(cancellation.runtime)
	return nil
}

//wails:ignore
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
