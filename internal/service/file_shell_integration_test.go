package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	msshssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestMergeTerminalDirectoryIntegrationAppendsIdempotentBlock(t *testing.T) {
	original := "# user aliases\nalias ll='ls -la'\n"

	merged, changed := mergeTerminalDirectoryIntegration(original, shellIntegrationBash)
	require.True(t, changed)
	require.Contains(t, merged, original)
	require.Contains(t, merged, "__mssh_emit_osc7_bash")
	require.Contains(t, merged, "PROMPT_COMMAND")

	mergedAgain, changedAgain := mergeTerminalDirectoryIntegration(merged, shellIntegrationBash)
	require.False(t, changedAgain)
	require.Equal(t, merged, mergedAgain)
	require.Equal(t, 1, strings.Count(mergedAgain, terminalDirectoryIntegrationStartMarker))
	require.Equal(t, 1, strings.Count(mergedAgain, terminalDirectoryIntegrationEndMarker))
}

func TestMergeTerminalDirectoryIntegrationReplacesExistingManagedBlock(t *testing.T) {
	legacy := "# before\n" +
		terminalDirectoryIntegrationStartMarker + "\n" +
		"old integration\n" +
		terminalDirectoryIntegrationEndMarker + "\n" +
		"# after\n"

	merged, changed := mergeTerminalDirectoryIntegration(legacy, shellIntegrationZsh)
	require.True(t, changed)
	require.NotContains(t, merged, "old integration")
	require.Contains(t, merged, "# before\n")
	require.Contains(t, merged, "# after\n")
	require.Contains(t, merged, "__mssh_emit_osc7_zsh")
	require.Contains(t, merged, "precmd_functions")
	require.Equal(t, 1, strings.Count(merged, terminalDirectoryIntegrationStartMarker))
	require.Equal(t, 1, strings.Count(merged, terminalDirectoryIntegrationEndMarker))
}

func TestTerminalDirectoryIntegrationTargetsUseLoginDirectory(t *testing.T) {
	targets, err := terminalDirectoryIntegrationTargets("/home/deploy")
	require.NoError(t, err)
	require.Equal(t, []shellIntegrationTarget{
		{shell: shellIntegrationBash, path: "/home/deploy/.bashrc", createIfMissing: true},
		{shell: shellIntegrationBash, path: "/home/deploy/.bash_profile"},
		{shell: shellIntegrationZsh, path: "/home/deploy/.zshrc", createIfMissing: true},
	}, targets)
}

func TestTerminalDirectoryIntegrationTargetsRejectUnsafeLoginDirectory(t *testing.T) {
	_, err := terminalDirectoryIntegrationTargets("/")
	require.ErrorContains(t, err, "login directory")

	_, err = terminalDirectoryIntegrationTargets("relative")
	require.ErrorContains(t, err, "login directory")
}

func TestInstallTerminalDirectoryIntegrationWritesStartupFiles(t *testing.T) {
	client := newFakeIntegrationClient("/home/deploy")
	client.files["/home/deploy/.bashrc"] = fakeRemoteEntry{
		content: "# existing bashrc\n",
		mode:    0o644,
	}

	paths, err := installTerminalDirectoryIntegration(client)

	require.NoError(t, err)
	require.Equal(t, []string{"/home/deploy/.bashrc", "/home/deploy/.zshrc"}, paths)
	require.Contains(t, client.files["/home/deploy/.bashrc"].content, "__mssh_emit_osc7_bash")
	require.Contains(t, client.files["/home/deploy/.zshrc"].content, "__mssh_emit_osc7_zsh")
	require.Equal(t, os.FileMode(0o644), client.files["/home/deploy/.bashrc"].mode)
	require.Equal(t, os.FileMode(0o600), client.files["/home/deploy/.zshrc"].mode)
	require.NotContains(t, client.files, "/home/deploy/.bash_profile")
	requireNoFileHasSuffix(t, client.files, ".tmp")
}

func TestInstallTerminalDirectoryIntegrationUpdatesExistingBashProfile(t *testing.T) {
	client := newFakeIntegrationClient("/home/deploy")
	client.files["/home/deploy/.bash_profile"] = fakeRemoteEntry{content: "# login\n", mode: 0o640}

	paths, err := installTerminalDirectoryIntegration(client)

	require.NoError(t, err)
	require.Contains(t, paths, "/home/deploy/.bash_profile")
	require.Contains(t, client.files["/home/deploy/.bash_profile"].content, "__mssh_emit_osc7_bash")
	require.Equal(t, os.FileMode(0o640), client.files["/home/deploy/.bash_profile"].mode)
}

func TestInstallShellIntegrationFileRejectsSymbolicLinks(t *testing.T) {
	client := newFakeIntegrationClient("/home/deploy")
	client.files["/home/deploy/.bashrc"] = fakeRemoteEntry{
		content: "source /etc/bashrc\n",
		mode:    os.ModeSymlink | 0o777,
	}

	managed, err := installShellIntegrationFile(client, shellIntegrationTarget{
		shell:           shellIntegrationBash,
		path:            "/home/deploy/.bashrc",
		createIfMissing: true,
	})

	require.False(t, managed)
	require.ErrorContains(t, err, "symbolic link")
}

func TestInstallShellIntegrationFileFallsBackWhenPosixRenameIsUnsupported(t *testing.T) {
	client := newFakeIntegrationClient("/home/deploy")
	client.posixRenameErr = sftp.ErrSSHFxOpUnsupported
	client.files["/home/deploy/.bashrc"] = fakeRemoteEntry{
		content: "# old\n",
		mode:    0o600,
	}

	managed, err := installShellIntegrationFile(client, shellIntegrationTarget{
		shell:           shellIntegrationBash,
		path:            "/home/deploy/.bashrc",
		createIfMissing: true,
	})

	require.NoError(t, err)
	require.True(t, managed)
	require.Contains(t, client.files["/home/deploy/.bashrc"].content, "__mssh_emit_osc7_bash")
	requireNoFileHasSuffix(t, client.files, ".tmp")
}

func TestInstallShellIntegrationFileKeepsCurrentManagedBlock(t *testing.T) {
	client := newFakeIntegrationClient("/home/deploy")
	client.files["/home/deploy/.bashrc"] = fakeRemoteEntry{
		content: terminalDirectoryIntegrationBlock(shellIntegrationBash) + "\n",
		mode:    0o600,
	}

	managed, err := installShellIntegrationFile(client, shellIntegrationTarget{
		shell:           shellIntegrationBash,
		path:            "/home/deploy/.bashrc",
		createIfMissing: true,
	})

	require.NoError(t, err)
	require.True(t, managed)
	requireNoFileHasSuffix(t, client.files, ".tmp")
}

func TestInstallShellIntegrationFileRejectsDirectories(t *testing.T) {
	client := newFakeIntegrationClient("/home/deploy")
	client.files["/home/deploy/.bashrc"] = fakeRemoteEntry{mode: os.ModeDir | 0o700}

	managed, err := installShellIntegrationFile(client, shellIntegrationTarget{
		shell:           shellIntegrationBash,
		path:            "/home/deploy/.bashrc",
		createIfMissing: true,
	})

	require.False(t, managed)
	require.ErrorContains(t, err, "directory")
}

func TestWriteRemoteIntegrationFilePropagatesTempCreateError(t *testing.T) {
	client := newFakeIntegrationClient("/home/deploy")
	client.tempOpenErr = errors.New("temp denied")

	err := writeRemoteIntegrationFile(client, "/home/deploy/.bashrc", "content", 0o600)

	require.ErrorContains(t, err, "temp denied")
}

func TestWriteRemoteIntegrationFilePropagatesReplaceError(t *testing.T) {
	client := newFakeIntegrationClient("/home/deploy")
	client.posixRenameErr = errors.New("replace denied")

	err := writeRemoteIntegrationFile(client, "/home/deploy/.bashrc", "content", 0o600)

	require.ErrorContains(t, err, "replace denied")
	requireNoFileHasSuffix(t, client.files, ".tmp")
}

func TestWriteRemoteIntegrationFilePropagatesChmodError(t *testing.T) {
	client := newFakeIntegrationClient("/home/deploy")
	client.chmodErr = errors.New("chmod denied")

	err := writeRemoteIntegrationFile(client, "/home/deploy/.bashrc", "content", 0)

	require.ErrorContains(t, err, "chmod denied")
	require.Contains(t, client.files, "/home/deploy/.bashrc")
}

func TestFileServiceInstallTerminalDirectoryIntegrationRejectsMissingSession(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionService := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	fileService := NewFileService(sessionService, newMockEventBus(), testutil.NewTestLogger())

	paths, err := fileService.InstallTerminalDirectoryIntegration(999)

	require.Nil(t, paths)
	require.ErrorContains(t, err, "install terminal directory integration")
}

func TestFileServiceInstallTerminalDirectoryIntegrationRejectsUnsafeSFTPLoginDirectory(t *testing.T) {
	sftpContext := startSFTPTestServer(t)
	defer sftpContext.cancel()
	fileService, session := createSFTPFileService(t, sftpContext)

	paths, err := fileService.InstallTerminalDirectoryIntegration(session.ID)

	require.Nil(t, paths)
	require.ErrorContains(t, err, "login directory")
}

func TestSFTPTerminalDirectoryIntegrationClientDelegates(t *testing.T) {
	sftpContext := startSFTPTestServer(t)
	defer sftpContext.cancel()
	service, session := createSFTPFileService(t, sftpContext)
	wrapper, connID, err := service.connect(context.Background(), session.ID)
	require.NoError(t, err)
	defer service.disconnect(connID)
	client, err := msshssh.OpenSFTP(wrapper)
	require.NoError(t, err)
	defer func() { require.NoError(t, client.Close()) }()
	adapter := sftpTerminalDirectoryIntegrationClient{client: client}

	_, err = adapter.Getwd()
	require.NoError(t, err)
	file, err := adapter.OpenFile("/osc7.txt", os.O_WRONLY|os.O_CREATE|os.O_EXCL|os.O_TRUNC)
	require.NoError(t, err)
	_, err = file.Write([]byte("content"))
	require.NoError(t, err)
	require.NoError(t, file.Close())
	info, err := adapter.Lstat("/osc7.txt")
	require.NoError(t, err)
	require.Equal(t, "osc7.txt", info.Name())
	require.NoError(t, adapter.Chmod("/osc7.txt", 0o600))
	require.NoError(t, adapter.Rename("/osc7.txt", "/osc7-renamed.txt"))
	if err = adapter.PosixRename("/osc7-renamed.txt", "/osc7-posix.txt"); errors.Is(err, sftp.ErrSSHFxOpUnsupported) {
		require.NoError(t, adapter.Rename("/osc7-renamed.txt", "/osc7-posix.txt"))
	} else {
		require.NoError(t, err)
	}
	require.NoError(t, adapter.Remove("/osc7-posix.txt"))
}

type fakeRemoteEntry struct {
	content string
	mode    os.FileMode
}

type fakeIntegrationClient struct {
	cwd            string
	files          map[string]fakeRemoteEntry
	posixRenameErr error
	tempOpenErr    error
	chmodErr       error
}

func newFakeIntegrationClient(cwd string) *fakeIntegrationClient {
	return &fakeIntegrationClient{cwd: cwd, files: map[string]fakeRemoteEntry{}}
}

func (c *fakeIntegrationClient) Getwd() (string, error) {
	return c.cwd, nil
}

func (c *fakeIntegrationClient) Lstat(remotePath string) (os.FileInfo, error) {
	entry, ok := c.files[remotePath]
	if !ok {
		return nil, os.ErrNotExist
	}
	return fakeRemoteFileInfo{name: path.Base(remotePath), mode: entry.mode}, nil
}

func (c *fakeIntegrationClient) OpenFile(remotePath string, flags int) (terminalDirectoryIntegrationFile, error) {
	if flags&os.O_WRONLY == 0 && flags&os.O_RDWR == 0 {
		entry, ok := c.files[remotePath]
		if !ok {
			return nil, os.ErrNotExist
		}
		return &fakeIntegrationFile{reader: strings.NewReader(entry.content)}, nil
	}
	if flags&os.O_EXCL != 0 {
		if _, exists := c.files[remotePath]; exists {
			return nil, os.ErrExist
		}
	}
	if c.tempOpenErr != nil && strings.HasSuffix(remotePath, ".tmp") {
		return nil, c.tempOpenErr
	}
	return &fakeIntegrationFile{onClose: func(content string) {
		c.files[remotePath] = fakeRemoteEntry{content: content, mode: 0o600}
	}}, nil
}

func (c *fakeIntegrationClient) PosixRename(oldPath, newPath string) error {
	if c.posixRenameErr != nil {
		return c.posixRenameErr
	}
	return c.rename(oldPath, newPath)
}

func (c *fakeIntegrationClient) Rename(oldPath, newPath string) error {
	return c.rename(oldPath, newPath)
}

func (c *fakeIntegrationClient) Chmod(remotePath string, mode os.FileMode) error {
	if c.chmodErr != nil {
		return c.chmodErr
	}
	entry, ok := c.files[remotePath]
	if !ok {
		return os.ErrNotExist
	}
	entry.mode = mode
	c.files[remotePath] = entry
	return nil
}

func (c *fakeIntegrationClient) Remove(remotePath string) error {
	if _, ok := c.files[remotePath]; !ok {
		return os.ErrNotExist
	}
	delete(c.files, remotePath)
	return nil
}

func (c *fakeIntegrationClient) rename(oldPath, newPath string) error {
	entry, ok := c.files[oldPath]
	if !ok {
		return os.ErrNotExist
	}
	c.files[newPath] = entry
	delete(c.files, oldPath)
	return nil
}

type fakeIntegrationFile struct {
	reader  *strings.Reader
	buffer  bytes.Buffer
	onClose func(string)
	closed  bool
}

func (f *fakeIntegrationFile) Read(p []byte) (int, error) {
	if f.reader == nil {
		return 0, io.EOF
	}
	return f.reader.Read(p)
}

func (f *fakeIntegrationFile) Write(p []byte) (int, error) {
	return f.buffer.Write(p)
}

func (f *fakeIntegrationFile) Close() error {
	if f.closed {
		return nil
	}
	f.closed = true
	if f.onClose != nil {
		f.onClose(f.buffer.String())
	}
	return nil
}

type fakeRemoteFileInfo struct {
	name string
	mode os.FileMode
}

func (f fakeRemoteFileInfo) Name() string { return f.name }

func (f fakeRemoteFileInfo) Size() int64 { return 0 }

func (f fakeRemoteFileInfo) Mode() os.FileMode { return f.mode }

func (f fakeRemoteFileInfo) ModTime() time.Time { return time.Time{} }

func (f fakeRemoteFileInfo) IsDir() bool { return f.mode.IsDir() }

func (f fakeRemoteFileInfo) Sys() any { return nil }

func requireNoFileHasSuffix(t *testing.T, files map[string]fakeRemoteEntry, suffix string) {
	t.Helper()
	for name := range files {
		require.False(t, strings.HasSuffix(name, suffix), "temporary file %s was not removed", name)
	}
}
