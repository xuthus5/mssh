package ssh

import (
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"

	"github.com/pkg/sftp"
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
	local, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open local: %w", err)
	}
	defer func() { _ = local.Close() }()
	info, err := local.Stat()
	if err != nil {
		return fmt.Errorf("stat local: %w", err)
	}

	remoteDir := remotePathDir(dst)
	if remoteDir != "." && remoteDir != "/" {
		if err := client.MkdirAll(remoteDir); err != nil {
			return fmt.Errorf("create remote dir: %w", err)
		}
	}

	remote, err := client.Create(dst)
	if err != nil {
		return fmt.Errorf("create remote: %w", err)
	}
	defer func() { _ = remote.Close() }()

	_, err = copyWithContext(ctx, remote, local, func(transferred int64) {
		if onProgress != nil {
			onProgress(transferred, info.Size())
		}
	})
	if err != nil {
		return fmt.Errorf("copy: %w", err)
	}
	return nil
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
	remote, err := client.Open(src)
	if err != nil {
		return fmt.Errorf("open remote: %w", err)
	}
	defer func() { _ = remote.Close() }()
	info, err := remote.Stat()
	if err != nil {
		return fmt.Errorf("stat remote: %w", err)
	}

	localDir := filepath.Dir(dst)
	if err := os.MkdirAll(localDir, 0o700); err != nil {
		return fmt.Errorf("create local dir: %w", err)
	}

	local, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("open local: %w", err)
	}
	defer func() { _ = local.Close() }()

	_, err = copyWithContext(ctx, local, remote, func(transferred int64) {
		if onProgress != nil {
			onProgress(transferred, info.Size())
		}
	})
	if err != nil {
		return fmt.Errorf("copy: %w", err)
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

func RemoveFile(client *sftp.Client, path string) error {
	if err := client.Remove(path); err != nil {
		return fmt.Errorf("remove %s: %w", path, err)
	}
	return nil
}

func RemoveDir(client *sftp.Client, path string) error {
	if err := client.RemoveDirectory(path); err != nil {
		return fmt.Errorf("remove dir %s: %w", path, err)
	}
	return nil
}

func Mkdir(client *sftp.Client, path string) error {
	if err := client.MkdirAll(path); err != nil {
		return fmt.Errorf("mkdir %s: %w", path, err)
	}
	return nil
}

func Rename(client *sftp.Client, oldname, newname string) error {
	if err := client.Rename(oldname, newname); err != nil {
		return fmt.Errorf("rename %s -> %s: %w", oldname, newname, err)
	}
	return nil
}

// RemoteFileSize returns the size in bytes of a remote file, or an error.
func RemoteFileSize(client *SFTPClient, path string) (int64, error) {
	info, err := client.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("stat remote %s: %w", path, err)
	}
	return info.Size(), nil
}

type progressWriter struct {
	total      int64
	onProgress ProgressFn
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n := len(p)
	pw.total += int64(n)
	if pw.onProgress != nil {
		pw.onProgress(pw.total, 0)
	}
	return n, nil
}
