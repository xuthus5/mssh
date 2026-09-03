package ssh

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"

	"github.com/pkg/sftp"

	"github.com/xuthus5/mssh/internal/fsutil"
)

// SFTPClient is an alias for the SFTP client, exported for use by the service layer.
type SFTPClient = sftp.Client

type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"is_dir"`
	ModTime string `json:"mod_time"`
}

type ProgressFn func(bytesTransferred, totalBytes int64)

func OpenSFTP(cw *ClientWrapper) (*sftp.Client, error) {
	client, err := sftp.NewClient(cw.Inner)
	if err != nil {
		return nil, fmt.Errorf("open sftp: %w", err)
	}
	return client, nil
}

func ListDir(client *sftp.Client, path string) ([]FileEntry, error) {
	entries, err := client.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("list dir %s: %w", path, err)
	}
	files := make([]FileEntry, 0, len(entries))
	for _, e := range entries {
		files = append(files, FileEntry{
			Name:    e.Name(),
			Path:    remotePathJoin(path, e.Name()),
			Size:    e.Size(),
			IsDir:   e.IsDir(),
			ModTime: e.ModTime().Format("2006-01-02 15:04:05"),
		})
	}
	return files, nil
}

func UploadFile(client *sftp.Client, src, dst string, onProgress ProgressFn) error {
	return UploadFileContext(context.Background(), client, src, dst, onProgress)
}

func UploadFileContext(ctx context.Context, client *sftp.Client, src, dst string, onProgress ProgressFn) error {
	_, err := uploadFileContext(ctx, client, src, dst, false, onProgress)
	return err
}

func uploadFileContext(
	ctx context.Context, client *sftp.Client, src, dst string, exclusive bool, onProgress ProgressFn,
) (bool, error) {
	local, info, err := openUploadSource(src)
	if err != nil {
		return false, fmt.Errorf("open local: %w", err)
	}
	defer func() { _ = local.Close() }()

	remoteDir := remotePathDir(dst)
	if remoteDir != "." && remoteDir != "/" {
		if err := client.MkdirAll(remoteDir); err != nil {
			return false, fmt.Errorf("create remote dir: %w", err)
		}
	}

	remote, err := openRemoteUploadTarget(client, dst, exclusive)
	if err != nil {
		return false, fmt.Errorf("create remote: %w", err)
	}
	remoteClosed := false
	defer func() {
		if !remoteClosed {
			_ = remote.Close()
		}
	}()

	_, copyErr := copyWithContext(ctx, remote, local, func(transferred int64) {
		if onProgress != nil {
			onProgress(transferred, info.Size())
		}
	})
	remoteClosed = true
	closeErr := finalizeUploadedFile(remote)
	if copyErr != nil {
		return true, errors.Join(fmt.Errorf("copy: %w", copyErr), closeErr)
	}
	if closeErr != nil {
		return true, closeErr
	}
	return true, nil
}

func remotePathJoin(base, name string) string {
	return path.Join(base, name)
}

func remotePathDir(remotePath string) string {
	return path.Dir(remotePath)
}

func DownloadFile(client *sftp.Client, src, dst string, onProgress ProgressFn) error {
	return DownloadFileContext(context.Background(), client, src, dst, onProgress)
}

func DownloadFileContext(ctx context.Context, client *sftp.Client, src, dst string, onProgress ProgressFn) error {
	_, err := downloadFileContext(ctx, client, src, dst, false, onProgress)
	return err
}

// DownloadFileExclusiveContext downloads into a path that must not already exist.
func DownloadFileExclusiveContext(ctx context.Context, client *sftp.Client, src, dst string, onProgress ProgressFn) error {
	_, err := downloadFileContext(ctx, client, src, dst, true, onProgress)
	return err
}

func downloadFileContext(
	ctx context.Context, client *sftp.Client, src, dst string, exclusive bool, onProgress ProgressFn,
) (bool, error) {
	remote, err := client.Open(src)
	if err != nil {
		return false, fmt.Errorf("open remote: %w", err)
	}
	defer func() { _ = remote.Close() }()
	info, err := remote.Stat()
	if err != nil {
		return false, fmt.Errorf("stat remote: %w", err)
	}

	localDir := filepath.Dir(dst)
	if err := os.MkdirAll(localDir, 0o700); err != nil {
		return false, fmt.Errorf("create local dir: %w", err)
	}

	local, temporaryPath, err := openDownloadTargetForDownload(dst, exclusive)
	if err != nil {
		return false, err
	}
	cleanupTemporary := true
	defer func() {
		if cleanupTemporary && temporaryPath != "" {
			_ = os.Remove(temporaryPath)
		}
	}()
	localClosed := false
	defer func() {
		if !localClosed {
			_ = local.Close()
		}
	}()

	_, copyErr := copyWithContext(ctx, local, remote, func(transferred int64) {
		if onProgress != nil {
			onProgress(transferred, info.Size())
		}
	})
	if copyErr != nil {
		localClosed = true
		closeErr := closeFile(local, "close partial local download")
		return true, errors.Join(fmt.Errorf("copy: %w", copyErr), closeErr)
	}
	localClosed = true
	if err := finalizeDownloadedFile(local); err != nil {
		return true, err
	}
	if temporaryPath != "" {
		if err := fsutil.ReplaceFile(temporaryPath, dst); err != nil {
			return true, fmt.Errorf("replace local download target: %w", err)
		}
		cleanupTemporary = false
	}
	return true, nil
}

func openDownloadTargetForDownload(path string, exclusive bool) (*os.File, string, error) {
	if exclusive {
		file, err := openDownloadTarget(path, true)
		return file, "", err
	}
	return openDownloadTemporary(path)
}

type durableDownloadedFile interface {
	Sync() error
	Close() error
}

func finalizeDownloadedFile(file durableDownloadedFile) error {
	syncErr := file.Sync()
	closeErr := file.Close()
	if syncErr != nil {
		syncErr = fmt.Errorf("sync local download: %w", syncErr)
	}
	if closeErr != nil {
		closeErr = fmt.Errorf("close local download: %w", closeErr)
	}
	return errors.Join(syncErr, closeErr)
}

func finalizeUploadedFile(file io.Closer) error {
	return closeFile(file, "close remote upload")
}

func closeFile(file io.Closer, operation string) error {
	if err := file.Close(); err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	return nil
}

func copyWithContext(ctx context.Context, dst io.Writer, src io.Reader, onProgress func(int64)) (int64, error) {
	buffer := make([]byte, 32*1024)
	var written int64
	for {
		select {
		case <-ctx.Done():
			return written, ctx.Err()
		default:
		}

		readCount, readErr := src.Read(buffer)
		if err := ctx.Err(); err != nil {
			return written, err
		}
		if readCount > 0 {
			var writeErr error
			written, writeErr = writeCopyChunk(dst, buffer[:readCount], written, onProgress)
			if writeErr != nil {
				return written, writeErr
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return written, nil
			}
			return written, readErr
		}
	}
}

func writeCopyChunk(dst io.Writer, data []byte, written int64, onProgress func(int64)) (int64, error) {
	writeCount, err := dst.Write(data)
	written += int64(writeCount)
	if onProgress != nil {
		onProgress(written)
	}
	if err != nil {
		return written, err
	}
	if writeCount != len(data) {
		return written, io.ErrShortWrite
	}
	return written, nil
}
