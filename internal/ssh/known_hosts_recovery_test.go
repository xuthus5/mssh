package ssh

import (
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func TestLoadKnownHostsCallbackIgnoresMalformedLines(t *testing.T) {
	public, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	key, err := gossh.NewPublicKey(public)
	require.NoError(t, err)
	valid := knownhosts.Line([]string{"example.com"}, key)
	path := filepath.Join(t.TempDir(), "known_hosts")
	require.NoError(t, os.WriteFile(path, []byte("broken ssh-ed25519 illegal-base64\n"+valid+"\n"), 0o600))

	callback, err := loadKnownHostsCallback(path)
	require.NoError(t, err)
	require.NoError(t, callback("example.com:22", &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 22}, key))
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Contains(t, string(content), "illegal-base64")
	matches, err := filepath.Glob(filepath.Join(filepath.Dir(path), ".known_hosts-validate-*"))
	require.NoError(t, err)
	require.Empty(t, matches)
}
