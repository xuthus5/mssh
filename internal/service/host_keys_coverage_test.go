package service

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestHostKeyListAndDeleteSuccess(t *testing.T) {
	dir := t.TempDir()
	svc := NewSessionService(nil, newMockEventBus(), 30, dir, nil, testutil.NewTestLogger())
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	sshPub, err := gossh.NewPublicKey(pub)
	require.NoError(t, err)
	line := "example.com " + sshPub.Type() + " " + base64.StdEncoding.EncodeToString(sshPub.Marshal())
	require.NoError(t, os.WriteFile(filepath.Join(dir, "known_hosts"), []byte(line+"\n# comment\n"), 0o600))

	entries, err := svc.ListHostKeys()
	require.NoError(t, err)
	require.NotEmpty(t, entries)
	require.NoError(t, svc.DeleteHostKey(entries[0].Line))
	after, err := svc.ListHostKeys()
	require.NoError(t, err)
	assert.Empty(t, after)
}

func TestHostKeyListMissingFile(t *testing.T) {
	svc := NewSessionService(nil, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	entries, err := svc.ListHostKeys()
	require.NoError(t, err)
	assert.Empty(t, entries)
}
