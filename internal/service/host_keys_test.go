package service

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSessionServiceListsAndDeletesKnownHosts(t *testing.T) {
	dataDir := t.TempDir()
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	key, err := gossh.NewPublicKey(publicKey)
	require.NoError(t, err)
	line := knownhosts.Line([]string{"example.com"}, key)
	require.NoError(t, os.WriteFile(filepath.Join(dataDir, "known_hosts"), []byte("# comment\n"+line+"\n"), 0o600))
	service := NewSessionService(nil, newMockEventBus(), 30, dataDir, nil, testutil.NewTestLogger())

	entries, err := service.ListHostKeys()
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, 2, entries[0].Line)
	require.Equal(t, "example.com", entries[0].Hosts)
	require.Equal(t, gossh.FingerprintSHA256(key), entries[0].Fingerprint)
	require.NoError(t, service.DeleteHostKey(entries[0].Line))
	entries, err = service.ListHostKeys()
	require.NoError(t, err)
	require.Empty(t, entries)
}

func TestSessionServiceHostKeyManagementErrors(t *testing.T) {
	service := NewSessionService(nil, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	entries, err := service.ListHostKeys()
	require.NoError(t, err)
	require.Empty(t, entries)
	require.Error(t, service.DeleteHostKey(0))
	require.Error(t, service.DeleteHostKey(1))
	require.False(t, func() bool { _, ok := parseKnownHostLine(1, fmt.Sprintf("invalid %s", "line")); return ok }())
}
