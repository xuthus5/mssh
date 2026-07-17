package service

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func TestSessionServiceHostKeyMalformedInputs(t *testing.T) {
	dataDir := t.TempDir()
	service := NewSessionService(nil, newMockEventBus(), 30, dataDir, nil, testutil.NewTestLogger())
	require.NoError(t, os.Mkdir(filepath.Join(dataDir, "known_hosts"), 0o700))
	_, err := service.ListHostKeys()
	require.Error(t, err)
	require.NoError(t, os.Remove(filepath.Join(dataDir, "known_hosts")))

	content := strings.Repeat("x", 70*1024)
	require.NoError(t, os.WriteFile(filepath.Join(dataDir, "known_hosts"), []byte(content), 0o600))
	_, err = service.ListHostKeys()
	require.Error(t, err)

	require.NoError(t, os.WriteFile(filepath.Join(dataDir, "known_hosts"), []byte("valid\n\n"), 0o600))
	require.Error(t, service.DeleteHostKey(2))
	require.Error(t, service.DeleteHostKey(9))

	_, ok := parseKnownHostLine(1, "@cert-authority host")
	require.False(t, ok)
	_, ok = parseKnownHostLine(1, "host ssh-ed25519 not-base64")
	require.False(t, ok)
	invalidKey := base64.StdEncoding.EncodeToString([]byte("not-a-public-key"))
	_, ok = parseKnownHostLine(1, "host ssh-ed25519 "+invalidKey)
	require.False(t, ok)

	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	key, err := gossh.NewPublicKey(publicKey)
	require.NoError(t, err)
	entry, ok := parseKnownHostLine(3, "@cert-authority "+knownhosts.Line([]string{"example.com"}, key))
	require.True(t, ok)
	require.Equal(t, "example.com", entry.Hosts)
}
