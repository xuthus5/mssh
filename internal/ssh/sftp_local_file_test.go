package ssh

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDownloadFileExclusiveContextRejectsExistingLocalPath(t *testing.T) {
	address, cleanup := startSFTPServer(t)
	defer cleanup()
	wrapper, client := connectSFTP(t, address)
	defer func() { _ = wrapper.Close() }()
	defer func() { _ = client.Close() }()
	remote, err := client.Create("/source")
	require.NoError(t, err)
	_, err = remote.Write([]byte("remote"))
	require.NoError(t, err)
	require.NoError(t, remote.Close())
	target := filepath.Join(t.TempDir(), "target")
	require.NoError(t, os.WriteFile(target, []byte("keep"), 0o600))

	err = DownloadFileExclusiveContext(context.Background(), client, "/source", target, nil)

	require.Error(t, err)
	content, readErr := os.ReadFile(target)
	require.NoError(t, readErr)
	assert.Equal(t, "keep", string(content))
}

func TestOpenExclusiveDownloadTargetRejectsExistingPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation requires elevated privileges on some Windows hosts")
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	require.NoError(t, os.WriteFile(target, []byte("keep"), 0o600))
	link := filepath.Join(dir, "partial")
	require.NoError(t, os.Symlink(target, link))

	_, err := openDownloadTarget(link, true)

	require.Error(t, err)
	content, readErr := os.ReadFile(target)
	require.NoError(t, readErr)
	assert.Equal(t, "keep", string(content))
}

func TestOpenExclusiveDownloadTargetCreatesPrivateRegularFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "partial")
	file, err := openDownloadTarget(path, true)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.True(t, info.Mode().IsRegular())
	if runtime.GOOS != "windows" {
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	}
}

func TestOpenUploadSourceRejectsDirectory(t *testing.T) {
	file, _, err := openUploadSource(t.TempDir())

	assert.Nil(t, file)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "regular file")
}
