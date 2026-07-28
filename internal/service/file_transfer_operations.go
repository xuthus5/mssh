package service

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/xuthus5/mssh/internal/fsutil"
	"github.com/xuthus5/mssh/internal/ssh"
)

type fileTransferOperations struct {
	upload         func(context.Context, *ssh.SFTPClient, string, string, ssh.ProgressFn) (bool, error)
	download       func(context.Context, *ssh.SFTPClient, string, string, ssh.ProgressFn) (bool, error)
	remoteFileSize func(*ssh.SFTPClient, string) (int64, error)
	removeRemote   func(*ssh.SFTPClient, string) error
	renameRemote   func(*ssh.SFTPClient, string, string) error
	removeLocal    func(string) error
	replaceLocal   func(string, string) error
}

func defaultFileTransferOperations() fileTransferOperations {
	return fileTransferOperations{
		upload:         ssh.UploadFileExclusiveContextWithOwnership,
		download:       ssh.DownloadFileExclusiveContextWithOwnership,
		remoteFileSize: ssh.RemoteFileSize,
		removeRemote:   ssh.RemoveFile,
		renameRemote:   ssh.Rename,
		removeLocal:    os.Remove,
		replaceLocal:   fsutil.ReplaceFile,
	}
}

func (operations fileTransferOperations) withDefaults() fileTransferOperations {
	defaults := defaultFileTransferOperations()
	if operations.upload == nil {
		operations.upload = defaults.upload
	}
	if operations.download == nil {
		operations.download = defaults.download
	}
	if operations.remoteFileSize == nil {
		operations.remoteFileSize = defaults.remoteFileSize
	}
	if operations.removeRemote == nil {
		operations.removeRemote = defaults.removeRemote
	}
	if operations.renameRemote == nil {
		operations.renameRemote = defaults.renameRemote
	}
	if operations.removeLocal == nil {
		operations.removeLocal = defaults.removeLocal
	}
	if operations.replaceLocal == nil {
		operations.replaceLocal = defaults.replaceLocal
	}
	return operations
}

func withFileTransferOperations(operations fileTransferOperations) FileServiceOption {
	return func(service *FileService) {
		service.transferOperations = operations.withDefaults()
	}
}

func (f *FileService) cleanupRemotePartial(client *ssh.SFTPClient, path string) error {
	err := f.transferOperations.removeRemote(client, path)
	return f.normalizePartialCleanupError("cleanup remote partial", path, err)
}

func (f *FileService) cleanupRemotePartialIfOwned(client *ssh.SFTPClient, path string, owned bool) error {
	if !owned {
		return nil
	}
	return f.cleanupRemotePartial(client, path)
}

func (f *FileService) cleanupLocalPartial(path string) error {
	err := f.transferOperations.removeLocal(path)
	return f.normalizePartialCleanupError("cleanup local partial", path, err)
}

func (f *FileService) cleanupLocalPartialIfOwned(path string, owned bool) error {
	if !owned {
		return nil
	}
	return f.cleanupLocalPartial(path)
}

func (f *FileService) normalizePartialCleanupError(operation, path string, err error) error {
	if err == nil || errors.Is(err, os.ErrNotExist) {
		return nil
	}
	cleanupErr := fmt.Errorf("%s %s: %w", operation, path, err)
	if f.logger != nil {
		f.logger.Error(operation+" failed", "path", path, "error", err)
	}
	return cleanupErr
}

func transferFailureOutcome(ctx context.Context, transferErr, cleanupErr error) transferOutcome {
	if transferAborted(ctx, transferErr) {
		return cancelledTransferOutcome(cleanupErr)
	}
	return failedTransferOutcome(errors.Join(transferErr, cleanupErr))
}
