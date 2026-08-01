package service

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"github.com/google/uuid"
	"github.com/pkg/sftp"

	"github.com/xuthus5/mssh/internal/ssh"
)

type shellIntegration string

const (
	shellIntegrationBash shellIntegration = "bash"
	shellIntegrationZsh  shellIntegration = "zsh"

	terminalDirectoryIntegrationStartMarker = "# >>> mssh osc7 cwd integration >>>"
	terminalDirectoryIntegrationEndMarker   = "# <<< mssh osc7 cwd integration <<<"
)

type shellIntegrationTarget struct {
	shell           shellIntegration
	path            string
	createIfMissing bool
}

type terminalDirectoryIntegrationClient interface {
	Getwd() (string, error)
	Lstat(string) (os.FileInfo, error)
	OpenFile(string, int) (terminalDirectoryIntegrationFile, error)
	PosixRename(string, string) error
	Rename(string, string) error
	Chmod(string, os.FileMode) error
	Remove(string) error
}

type terminalDirectoryIntegrationFile interface {
	io.Reader
	io.Writer
	io.Closer
}

var errShellIntegrationTargetMissing = errors.New("shell integration target missing")

var (
	_detectTerminalShellIntegration                = detectTerminalShellIntegration
	_installTerminalDirectoryIntegrationForWrapper = installTerminalDirectoryIntegrationForWrapper
)

type sftpTerminalDirectoryIntegrationClient struct {
	client *sftp.Client
}

func (c sftpTerminalDirectoryIntegrationClient) Getwd() (string, error) {
	return c.client.Getwd()
}

func (c sftpTerminalDirectoryIntegrationClient) Lstat(remotePath string) (os.FileInfo, error) {
	return c.client.Lstat(remotePath)
}

func (c sftpTerminalDirectoryIntegrationClient) OpenFile(remotePath string, flags int) (terminalDirectoryIntegrationFile, error) {
	return c.client.OpenFile(remotePath, flags)
}

func (c sftpTerminalDirectoryIntegrationClient) PosixRename(oldPath, newPath string) error {
	return c.client.PosixRename(oldPath, newPath)
}

func (c sftpTerminalDirectoryIntegrationClient) Rename(oldPath, newPath string) error {
	return c.client.Rename(oldPath, newPath)
}

func (c sftpTerminalDirectoryIntegrationClient) Chmod(remotePath string, mode os.FileMode) error {
	return c.client.Chmod(remotePath, mode)
}

func (c sftpTerminalDirectoryIntegrationClient) Remove(remotePath string) error {
	return c.client.Remove(remotePath)
}

func parseShellIntegration(value string) (shellIntegration, bool) {
	name := strings.TrimPrefix(path.Base(strings.TrimSpace(value)), "-")
	switch name {
	case string(shellIntegrationBash):
		return shellIntegrationBash, true
	case string(shellIntegrationZsh):
		return shellIntegrationZsh, true
	default:
		return "", false
	}
}

func detectTerminalShellIntegration(wrapper *ssh.ClientWrapper) (shellIntegration, bool, error) {
	output, err := _runSystemInfoCommand(wrapper, `printf '%s\n' "${SHELL:-}"`)
	if err != nil {
		return "", false, fmt.Errorf("detect shell: %w", err)
	}
	shell, ok := parseShellIntegration(string(output))
	return shell, ok, nil
}

func installTerminalDirectoryIntegrationForWrapper(
	wrapper *ssh.ClientWrapper,
	shell shellIntegration,
) (string, bool, error) {
	deadline, err := setSFTPMetadataDeadline(wrapper)
	if err != nil {
		return "", false, fmt.Errorf("install terminal directory integration: %w", err)
	}
	client, err := ssh.OpenSFTP(wrapper)
	if err != nil {
		return "", false, sftpMetadataError("install terminal directory integration", deadline, err)
	}
	defer func() { _ = client.Close() }()
	remotePath, managed, err := installTerminalDirectoryIntegrationForShell(
		sftpTerminalDirectoryIntegrationClient{client: client},
		shell,
	)
	if err != nil {
		return "", false, sftpMetadataError("install terminal directory integration", deadline, err)
	}
	return remotePath, managed, nil
}

func installTerminalDirectoryIntegrationForShell(
	client terminalDirectoryIntegrationClient,
	shell shellIntegration,
) (string, bool, error) {
	loginDir, err := client.Getwd()
	if err != nil {
		return "", false, fmt.Errorf("resolve login directory: %w", err)
	}
	target, err := terminalDirectoryIntegrationTarget(loginDir, shell)
	if err != nil {
		return "", false, err
	}
	managed, err := installShellIntegrationFile(client, target)
	return target.path, managed, err
}

func terminalDirectoryIntegrationTarget(
	loginDir string,
	shell shellIntegration,
) (shellIntegrationTarget, error) {
	cleaned := path.Clean(strings.TrimSpace(loginDir))
	if cleaned == "" || cleaned == "." || cleaned == "/" || !path.IsAbs(cleaned) {
		return shellIntegrationTarget{}, fmt.Errorf("login directory is not usable: %q", loginDir)
	}
	switch shell {
	case shellIntegrationBash:
		return shellIntegrationTarget{shell: shell, path: path.Join(cleaned, ".bashrc"), createIfMissing: true}, nil
	case shellIntegrationZsh:
		return shellIntegrationTarget{shell: shell, path: path.Join(cleaned, ".zshrc"), createIfMissing: true}, nil
	default:
		return shellIntegrationTarget{}, fmt.Errorf("unsupported shell integration: %s", shell)
	}
}

func installShellIntegrationFile(client terminalDirectoryIntegrationClient, target shellIntegrationTarget) (bool, error) {
	existing, mode, err := readRemoteIntegrationFile(client, target.path, target.createIfMissing)
	if errors.Is(err, errShellIntegrationTargetMissing) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	merged, changed := mergeTerminalDirectoryIntegration(existing, target.shell)
	if !changed {
		return true, nil
	}
	if err := writeRemoteIntegrationFile(client, target.path, merged, mode); err != nil {
		return false, err
	}
	return true, nil
}

func readRemoteIntegrationFile(client terminalDirectoryIntegrationClient, remotePath string, createIfMissing bool) (string, os.FileMode, error) {
	info, err := client.Lstat(remotePath)
	switch {
	case err == nil:
		if info.Mode()&os.ModeSymlink != 0 {
			return "", 0, fmt.Errorf("refusing to update symbolic link: %s", remotePath)
		}
		if info.IsDir() {
			return "", 0, fmt.Errorf("refusing to update directory: %s", remotePath)
		}
		file, openErr := client.OpenFile(remotePath, os.O_RDONLY)
		if openErr != nil {
			return "", 0, fmt.Errorf("open remote file %s: %w", remotePath, openErr)
		}
		content, readErr := io.ReadAll(file)
		closeErr := file.Close()
		if readErr != nil {
			return "", 0, fmt.Errorf("read remote file %s: %w", remotePath, readErr)
		}
		if closeErr != nil {
			return "", 0, fmt.Errorf("close remote file %s: %w", remotePath, closeErr)
		}
		return string(content), info.Mode().Perm(), nil
	case isRemoteNotExist(err):
		if !createIfMissing {
			return "", 0, errShellIntegrationTargetMissing
		}
		return "", 0, nil
	default:
		return "", 0, fmt.Errorf("stat remote file %s: %w", remotePath, err)
	}
}

func writeRemoteIntegrationFile(client terminalDirectoryIntegrationClient, remotePath, content string, mode os.FileMode) error {
	tempPath := remotePath + ".mssh-" + uuid.NewString() + ".tmp"
	tempFile, err := client.OpenFile(tempPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("create temporary file %s: %w", tempPath, err)
	}
	removeTemp := true
	defer func() {
		if removeTemp {
			_ = client.Remove(tempPath)
		}
	}()
	if _, err = io.WriteString(tempFile, content); err != nil {
		_ = tempFile.Close()
		return fmt.Errorf("write temporary file %s: %w", tempPath, err)
	}
	if err = tempFile.Close(); err != nil {
		return fmt.Errorf("close temporary file %s: %w", tempPath, err)
	}
	if err = client.PosixRename(tempPath, remotePath); err != nil {
		if !errors.Is(err, sftp.ErrSSHFxOpUnsupported) {
			return fmt.Errorf("replace remote file %s: %w", remotePath, err)
		}
		if removeErr := client.Remove(remotePath); removeErr != nil && !isRemoteNotExist(removeErr) {
			return fmt.Errorf("remove remote file %s: %w", remotePath, removeErr)
		}
		if renameErr := client.Rename(tempPath, remotePath); renameErr != nil {
			return fmt.Errorf("rename temporary file %s: %w", remotePath, renameErr)
		}
	}
	removeTemp = false
	if mode == 0 {
		mode = 0o600
	}
	if err = client.Chmod(remotePath, mode); err != nil {
		return fmt.Errorf("set remote file permissions %s: %w", remotePath, err)
	}
	return nil
}

func isRemoteNotExist(err error) bool {
	return errors.Is(err, os.ErrNotExist)
}
