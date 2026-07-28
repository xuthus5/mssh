package ssh

import (
	"context"
	"os"

	"github.com/pkg/sftp"
)

// UploadFileExclusiveContextWithOwnership uploads to a new remote path and reports whether it created that path.
func UploadFileExclusiveContextWithOwnership(
	ctx context.Context, client *sftp.Client, src, dst string, onProgress ProgressFn,
) (bool, error) {
	return uploadFileContext(ctx, client, src, dst, true, onProgress)
}

func openRemoteUploadTarget(client *sftp.Client, path string, exclusive bool) (*sftp.File, error) {
	if exclusive {
		return client.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	}
	return client.Create(path)
}

// DownloadFileExclusiveContextWithOwnership downloads to a new local path and reports whether it created that path.
func DownloadFileExclusiveContextWithOwnership(
	ctx context.Context, client *sftp.Client, src, dst string, onProgress ProgressFn,
) (bool, error) {
	return downloadFileContext(ctx, client, src, dst, true, onProgress)
}
