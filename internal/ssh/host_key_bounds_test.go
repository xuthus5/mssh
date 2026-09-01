package ssh

import (
	"encoding/base64"
	"errors"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

	_, err := createHostKeyCallback(path, HostKeyOptions{}, slog.Default())

	assert.ErrorContains(t, err, "regular file")
}

func TestCreateHostKeyCallbackRejectsOversizedKnownHosts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, nil, 0o600))
	require.NoError(t, os.Truncate(path, testKnownHostsLimit+1))

	_, err := createHostKeyCallback(path, HostKeyOptions{}, slog.Default())

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

func TestCreateHostKeyCallbackRecoversMalformedKnownHosts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, []byte("example.com ssh-ed25519 invalid\n"), 0o600))

	callback, err := createHostKeyCallback(path, HostKeyOptions{}, slog.Default())

	assert.NotNil(t, callback)
	assert.NoError(t, err)
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

func TestHandleChangedHostKeyBlockRejects(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	oldKey := newTestPublicKey(t)
	require.NoError(t, appendKnownHost(path, "example.com:22", oldKey))
	check := hostKeyCheck{
		hostname: "example.com:22", remote: &net.TCPAddr{Port: 22}, key: newTestPublicKey(t),
		knownHostsPath: path, policy: HostKeyPolicyBlock,
	}
	callback, err := loadKnownHostsCallback(path)
	require.NoError(t, err)
	check.callback = callback

	err = verifyHostKey(check)

	assert.ErrorContains(t, err, "changed")
}

func TestHandleChangedHostKeyTrustReplaces(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	oldKey := newTestPublicKey(t)
	require.NoError(t, appendKnownHost(path, "example.com:22", oldKey))
	newKey := newTestPublicKey(t)
	check := hostKeyCheck{
		hostname: "example.com:22", remote: &net.TCPAddr{Port: 22}, key: newKey,
		knownHostsPath: path, policy: HostKeyPolicyTrust,
	}
	callback, err := loadKnownHostsCallback(path)
	require.NoError(t, err)
	check.callback = callback

	err = verifyHostKey(check)

	require.NoError(t, err)
	content, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	assert.Contains(t, string(content), keyMaterial(newKey))
	assert.NotContains(t, string(content), keyMaterial(oldKey))
}

func TestHandleChangedHostKeyWarnAccepts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	oldKey := newTestPublicKey(t)
	require.NoError(t, appendKnownHost(path, "example.com:22", oldKey))
	newKey := newTestPublicKey(t)
	var captured []string
	changed := func(_ string, _ string, _ string, expected []string) bool {
		captured = expected
		return true
	}
	check := hostKeyCheck{
		hostname: "example.com:22", remote: &net.TCPAddr{Port: 22}, key: newKey,
		knownHostsPath: path, policy: HostKeyPolicyWarn, onHostKeyChange: changed,
	}
	callback, err := loadKnownHostsCallback(path)
	require.NoError(t, err)
	check.callback = callback

	err = verifyHostKey(check)

	require.NoError(t, err)
	require.Len(t, captured, 1)
	assert.Contains(t, captured[0], gossh.FingerprintSHA256(oldKey))
	content, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	assert.Contains(t, string(content), keyMaterial(newKey))
	assert.NotContains(t, string(content), keyMaterial(oldKey))
}

func TestHandleChangedHostKeyWarnRejects(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	oldKey := newTestPublicKey(t)
	require.NoError(t, appendKnownHost(path, "example.com", oldKey))
	check := hostKeyCheck{
		hostname: "example.com:22", remote: &net.TCPAddr{Port: 22}, key: newTestPublicKey(t),
		knownHostsPath: path, policy: HostKeyPolicyWarn,
		onHostKeyChange: func(_ string, _ string, _ string, _ []string) bool { return false },
	}
	callback, err := loadKnownHostsCallback(path)
	require.NoError(t, err)
	check.callback = callback

	err = verifyHostKey(check)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "rejected by user")
}

func TestHandleNewHostKeyTrustAcceptsWithoutPrompt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, nil, 0o600))
	prompted := false
	check := hostKeyCheck{
		hostname: "example.com:22", remote: &net.TCPAddr{Port: 22}, key: newTestPublicKey(t),
		knownHostsPath: path, policy: HostKeyPolicyTrust,
		onNewHostKey: func(_, _, _ string) bool { prompted = true; return true },
	}
	callback, err := loadKnownHostsCallback(path)
	require.NoError(t, err)
	check.callback = callback

	err = verifyHostKey(check)

	require.NoError(t, err)
	assert.False(t, prompted)
	content, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	assert.NotEmpty(t, strings.TrimSpace(string(content)))
}

func TestKnownHostLineForHost(t *testing.T) {
	assert.True(t, knownHostLineForHost("example.com ssh-ed25519 AAAA", "example.com"))
	assert.True(t, knownHostLineForHost("example.com:22 ssh-ed25519 AAAA", "example.com"))
	assert.True(t, knownHostLineForHost("a.example.com,b.example.com ssh-ed25519 AAAA", "b.example.com"))
	assert.False(t, knownHostLineForHost("other.com ssh-ed25519 AAAA", "example.com"))
	assert.False(t, knownHostLineForHost("# comment ssh-ed25519 AAAA", "example.com"))
	assert.False(t, knownHostLineForHost("|1|abc|def ssh-ed25519 AAAA", "example.com"))
	assert.False(t, knownHostLineForHost("@revoked example.com ssh-ed25519 AAAA", "example.com"))
	assert.False(t, knownHostLineForHost("", "example.com"))
	assert.False(t, knownHostLineForHost("malformed", "example.com"))
}

func keyMaterial(key gossh.PublicKey) string {
	return base64.StdEncoding.EncodeToString(key.Marshal())
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
