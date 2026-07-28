package ssh

import (
	"errors"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

const testKnownHostsLimit = 8 << 20

func TestEnsureKnownHostsFileRejectsNonRegularPath(t *testing.T) {
	directory := t.TempDir()

	err := ensureKnownHostsFile(directory)

	assert.ErrorContains(t, err, "regular file")
}

func TestEnsureKnownHostsFileSecuresExistingFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not preserve Unix permission bits")
	}
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, nil, 0o644))

	require.NoError(t, ensureKnownHostsFile(path))

	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}

func TestCreateHostKeyCallbackRejectsKnownHostsSymbolicLink(t *testing.T) {
	target := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(target, nil, 0o600))
	path := filepath.Join(t.TempDir(), "known_hosts")
	if err := os.Symlink(target, path); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}

	_, err := createHostKeyCallback(path, nil, slog.Default())

	assert.ErrorContains(t, err, "regular file")
}

func TestCreateHostKeyCallbackRejectsOversizedKnownHosts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, nil, 0o600))
	require.NoError(t, os.Truncate(path, testKnownHostsLimit+1))

	_, err := createHostKeyCallback(path, nil, slog.Default())

	assert.ErrorContains(t, err, "known_hosts exceeds")
}

func TestAppendKnownHostRejectsProjectedSizeOverflow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, nil, 0o600))
	require.NoError(t, os.Truncate(path, testKnownHostsLimit))

	err := appendKnownHost(path, "example.com", newTestPublicKey(t))

	assert.ErrorContains(t, err, "known_hosts exceeds")
	info, statErr := os.Stat(path)
	require.NoError(t, statErr)
	assert.Equal(t, int64(testKnownHostsLimit), info.Size())
}

func TestCreateHostKeyCallbackRejectsMalformedKnownHosts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, []byte("example.com ssh-ed25519 invalid\n"), 0o600))

	callback, err := createHostKeyCallback(path, nil, slog.Default())

	assert.Nil(t, callback)
	assert.ErrorContains(t, err, "parse known_hosts")
}

func TestVerifyHostKeyReturnsNonKeyError(t *testing.T) {
	primary := errors.New("callback failure")
	check := hostKeyCheck{
		callback: func(string, net.Addr, gossh.PublicKey) error { return primary },
		hostname: "example.com", remote: &net.TCPAddr{}, key: newTestPublicKey(t),
	}

	err := verifyHostKey(check)

	assert.ErrorIs(t, err, primary)
}

func TestHostKeyChangedErrorHandlesMissingExpectedKey(t *testing.T) {
	err := hostKeyChangedError("example.com", newTestPublicKey(t), &knownhosts.KeyError{})

	assert.ErrorContains(t, err, "presented")
}

func TestHostKeyOperationsRejectMissingKnownHosts(t *testing.T) {
	check := hostKeyCheck{
		hostname: "example.com", remote: &net.TCPAddr{}, key: newTestPublicKey(t),
		knownHostsPath: filepath.Join(t.TempDir(), "missing"),
	}

	assert.Error(t, handleNewHostKey(check))
	assert.Error(t, appendKnownHostIfUnknown(check))
	callback, err := loadKnownHostsCallback(check.knownHostsPath)
	assert.Nil(t, callback)
	assert.Error(t, err)
}

func TestAppendKnownHostIfUnknownHandlesCurrentState(t *testing.T) {
	trustedPath := filepath.Join(t.TempDir(), "trusted")
	trustedKey := newTestPublicKey(t)
	require.NoError(t, appendKnownHost(trustedPath, "example.com", trustedKey))
	trusted := hostKeyCheck{
		hostname: "example.com:22", remote: &net.TCPAddr{Port: 22}, key: trustedKey, knownHostsPath: trustedPath,
	}
	require.NoError(t, appendKnownHostIfUnknown(trusted))

	changedPath := filepath.Join(t.TempDir(), "changed")
	require.NoError(t, appendKnownHost(changedPath, "example.com", newTestPublicKey(t)))
	changed := hostKeyCheck{
		hostname: "example.com:22", remote: &net.TCPAddr{Port: 22}, key: newTestPublicKey(t), knownHostsPath: changedPath,
	}
	assert.ErrorContains(t, appendKnownHostIfUnknown(changed), "changed")
}
