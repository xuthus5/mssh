package ssh

import (
	"fmt"
	"os"

	"github.com/pkg/sftp"
)

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

// CreateFile creates an empty remote file and fails when the path is taken, so an
// existing file is never truncated.
func CreateFile(client *sftp.Client, path string) error {
	file, err := client.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close created %s: %w", path, err)
	}
	return nil
}

func Rename(client *sftp.Client, oldname, newname string) error {
	if err := client.Rename(oldname, newname); err != nil {
		return fmt.Errorf("rename %s -> %s: %w", oldname, newname, err)
	}
	return nil
}

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
