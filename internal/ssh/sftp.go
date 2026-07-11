package ssh

import (
	"fmt"
	"io"
	"os"
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
			Path:    filepath.Join(path, e.Name()),
			Size:    e.Size(),
			IsDir:   e.IsDir(),
			ModTime: e.ModTime().Format("2006-01-02 15:04:05"),
		})
	}
	return files, nil
}

func UploadFile(client *sftp.Client, src, dst string, onProgress ProgressFn) error {
	local, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open local: %w", err)
	}
	defer local.Close()

	remoteDir := filepath.Dir(dst)
	if remoteDir != "." && remoteDir != "/" {
		_ = client.MkdirAll(remoteDir)
	}

	remote, err := client.Create(dst)
	if err != nil {
		return fmt.Errorf("create remote: %w", err)
	}
	defer remote.Close()

	pw := &progressWriter{onProgress: onProgress}
	_, err = io.Copy(remote, io.TeeReader(local, pw))
	if err != nil {
		return fmt.Errorf("copy: %w", err)
	}
	return nil
}

func DownloadFile(client *sftp.Client, src, dst string, onProgress ProgressFn) error {
	remote, err := client.Open(src)
	if err != nil {
		return fmt.Errorf("open remote: %w", err)
	}
	defer remote.Close()

	localDir := filepath.Dir(dst)
	if err := os.MkdirAll(localDir, 0o700); err != nil {
		return fmt.Errorf("create local dir: %w", err)
	}

	local, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("open local: %w", err)
	}
	defer local.Close()

	pw := &progressWriter{onProgress: onProgress}
	_, err = io.Copy(local, io.TeeReader(remote, pw))
	if err != nil {
		return fmt.Errorf("copy: %w", err)
	}
	return nil
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
