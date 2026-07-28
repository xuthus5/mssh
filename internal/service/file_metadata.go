package service

import (
	"context"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/ssh"
)

// Delete removes a remote file through SFTP.
func (f *FileService) Delete(sessionID int64, path string) error {
	if err := validateRemotePath(path); err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	return f.runMetadataMutation(sessionID, "delete", func(client *ssh.SFTPClient) error {
		return ssh.RemoveFile(client, path)
	})
}

// Mkdir creates a remote directory through SFTP.
func (f *FileService) Mkdir(sessionID int64, path string) error {
	if err := validateRemotePath(path); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	return f.runMetadataMutation(sessionID, "mkdir", func(client *ssh.SFTPClient) error {
		return ssh.Mkdir(client, path)
	})
}

// Rename renames a remote file through SFTP.
func (f *FileService) Rename(sessionID int64, oldPath, newPath string) error {
	if err := validateRemotePath(oldPath); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	if err := validateRemotePath(newPath); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	return f.runMetadataMutation(sessionID, "rename", func(client *ssh.SFTPClient) error {
		return ssh.Rename(client, oldPath, newPath)
	})
}

func (f *FileService) runMetadataMutation(sessionID int64, action string, mutate func(*ssh.SFTPClient) error) error {
	finish, err := f.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	wrapper, connID, err := f.connect(context.Background(), sessionID)
	if err != nil {
		return fmt.Errorf("%s: %w", action, err)
	}
	defer f.disconnect(connID)
	deadline, err := setSFTPMetadataDeadline(wrapper)
	if err != nil {
		return fmt.Errorf("%s: %w", action, err)
	}
	sftpClient, err := ssh.OpenSFTP(wrapper)
	if err != nil {
		return sftpMetadataError(action, deadline, err)
	}
	defer func() { _ = sftpClient.Close() }()
	if err := mutate(sftpClient); err != nil {
		return sftpMetadataError(action, deadline, err)
	}
	return nil
}

func setSFTPMetadataDeadline(wrapper *ssh.ClientWrapper) (time.Time, error) {
	deadline := time.Now().Add(sftpMetadataOperationTimeout)
	if err := wrapper.SetDeadline(deadline); err != nil {
		return time.Time{}, fmt.Errorf("set SFTP operation deadline: %w", err)
	}
	return deadline, nil
}

func sftpMetadataError(action string, deadline time.Time, err error) error {
	if !time.Now().Before(deadline) {
		return fmt.Errorf("%s timed out after %s: %w", action, sftpMetadataOperationTimeout, err)
	}
	return fmt.Errorf("%s: %w", action, err)
}
