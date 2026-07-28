package ssh

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCloseKnownHostsWithErrorPreservesCloseFailure(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "closed-*")
	require.NoError(t, err)
	require.NoError(t, file.Close())
	primary := errors.New("primary failure")

	err = closeKnownHostsWithError(file, primary)

	assert.ErrorIs(t, err, primary)
	assert.ErrorIs(t, err, os.ErrClosed)
}

func TestCloseKnownHostsWithErrorReturnsPrimaryError(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "open-*")
	require.NoError(t, err)
	primary := errors.New("primary failure")

	err = closeKnownHostsWithError(file, primary)

	assert.ErrorIs(t, err, primary)
}

func TestAppendKnownHostCreatesMissingPrivateFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")

	require.NoError(t, appendKnownHost(path, "example.com", newTestPublicKey(t)))

	content, err := ReadKnownHostsFile(path)
	require.NoError(t, err)
	assert.NotEmpty(t, content)
	if runtime.GOOS != "windows" {
		info, statErr := os.Stat(path)
		require.NoError(t, statErr)
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	}
}

func TestCreateKnownHostsAppendFileRejectsOversizedEntry(t *testing.T) {
	file, err := createKnownHostsAppendFile(filepath.Join(t.TempDir(), "known_hosts"), maxKnownHostsFileBytes+1)

	assert.Nil(t, file)
	assert.ErrorContains(t, err, "known_hosts exceeds")
}

func TestLoadKnownHostsCallbackRejectsMalformedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, []byte("example.com ssh-ed25519 invalid\n"), 0o600))

	callback, err := loadKnownHostsCallback(path)

	assert.Nil(t, callback)
	assert.ErrorContains(t, err, "parse known_hosts")
}

func TestCreateKnownHostsAppendFileRejectsExistingPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, nil, 0o600))

	file, err := createKnownHostsAppendFile(path, 1)

	assert.Nil(t, file)
	assert.ErrorContains(t, err, "create known_hosts")
}

func TestOpenKnownHostsAppendFileRejectsSymbolicLink(t *testing.T) {
	target := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(target, nil, 0o600))
	path := filepath.Join(t.TempDir(), "known_hosts")
	if err := os.Symlink(target, path); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}

	file, err := openKnownHostsAppendFile(path, 1)

	assert.Nil(t, file)
	assert.ErrorContains(t, err, "regular file")
}

func TestReadKnownHostsFileRejectsSymbolicLink(t *testing.T) {
	target := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(target, nil, 0o600))
	path := filepath.Join(t.TempDir(), "known_hosts")
	if err := os.Symlink(target, path); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}

	content, err := ReadKnownHostsFile(path)

	assert.Nil(t, content)
	assert.ErrorContains(t, err, "regular file")
}
