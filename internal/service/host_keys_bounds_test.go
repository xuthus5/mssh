package service

import (
	"crypto/ed25519"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

const testOversizedKnownHostsBytes = 8<<20 + 1

func TestHostKeyManagementRejectsOversizedFile(t *testing.T) {
	tests := []struct {
		name string
		call func(*SessionService) error
	}{
		{name: "list", call: func(service *SessionService) error { _, err := service.ListHostKeys(); return err }},
		{name: "delete", call: func(service *SessionService) error { return service.DeleteHostKey(1) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dataDir := t.TempDir()
			path := filepath.Join(dataDir, "known_hosts")
			require.NoError(t, os.WriteFile(path, nil, 0o600))
			require.NoError(t, os.Truncate(path, testOversizedKnownHostsBytes))
			service := NewSessionService(nil, newMockEventBus(), 30, dataDir, nil, testutil.NewTestLogger())

			err := test.call(service)

			assert.ErrorContains(t, err, "known_hosts exceeds")
			info, statErr := os.Stat(path)
			require.NoError(t, statErr)
			assert.Equal(t, int64(testOversizedKnownHostsBytes), info.Size())
		})
	}
}

func TestHostKeyManagementRejectsSymbolicLink(t *testing.T) {
	tests := []struct {
		name string
		call func(*SessionService) error
	}{
		{name: "list", call: func(service *SessionService) error { _, err := service.ListHostKeys(); return err }},
		{name: "delete", call: func(service *SessionService) error { return service.DeleteHostKey(1) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dataDir := t.TempDir()
			target := filepath.Join(t.TempDir(), "known_hosts")
			require.NoError(t, os.WriteFile(target, []byte(testKnownHostLine(t)+"\n"), 0o600))
			path := filepath.Join(dataDir, "known_hosts")
			if err := os.Symlink(target, path); err != nil {
				t.Skipf("symbolic links unavailable: %v", err)
			}
			service := NewSessionService(nil, newMockEventBus(), 30, dataDir, nil, testutil.NewTestLogger())

			err := test.call(service)

			assert.ErrorContains(t, err, "regular file")
			info, statErr := os.Lstat(path)
			require.NoError(t, statErr)
			assert.NotZero(t, info.Mode()&os.ModeSymlink)
		})
	}
}

func testKnownHostLine(t *testing.T) string {
	t.Helper()
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	key, err := gossh.NewPublicKey(publicKey)
	require.NoError(t, err)
	return knownhosts.Line([]string{"example.com"}, key)
}

func TestDeleteHostKeyUsesTargetDirectoryForAtomicReplacement(t *testing.T) {
	knownHostsPath := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(knownHostsPath, []byte(testKnownHostLine(t)+"\n"), 0o600))
	invalidDataDir := filepath.Join(t.TempDir(), "not-a-directory")
	require.NoError(t, os.WriteFile(invalidDataDir, nil, 0o600))
	service := NewSessionService(nil, newMockEventBus(), 30, invalidDataDir, nil, testutil.NewTestLogger())

	err := service.deleteHostKeyLocked(knownHostsPath, 1)

	require.NoError(t, err)
	content, readErr := os.ReadFile(knownHostsPath)
	require.NoError(t, readErr)
	assert.Empty(t, content)
}

func TestParseKnownHostLineRejectsIncompleteMarker(t *testing.T) {
	_, ok := parseKnownHostLine(1, "@cert-authority example.com ssh-ed25519")

	assert.False(t, ok)
}
