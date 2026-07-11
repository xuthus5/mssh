//go:build e2e

package e2e_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestAppRealSSH(t *testing.T) {
	a := newTestApp(t)

	home, _ := os.UserHomeDir()
	keyBytes, err := os.ReadFile(home + "/.ssh/id_ed25519")
	require.NoError(t, err)

	// Import the key
	key, err := a.Key.Import("test-ed25519", string(keyBytes))
	require.NoError(t, err, "key import failed — OpenSSH format not supported")
	t.Cleanup(func() { _ = a.Key.Delete(key.ID) })
	t.Logf("Key imported id=%d type=%s", key.ID, key.Type)

	// Create session with key auth
	s, err := a.Session.CreateSession(model.Session{
		Name: "real-ssh-test", Host: "127.0.0.1", Port: 30022,
		Username: "root", AuthMethod: model.AuthKey, KeyID: &key.ID, KeepAlive: 30,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = a.Session.DeleteSession(s.ID) })
	t.Logf("Session created id=%d", s.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	terminalID, err := a.Terminal.Open(ctx, s.ID, 80, 24)
	require.NoError(t, err)
	t.Cleanup(func() { _ = a.Terminal.Close(terminalID) })
	t.Logf("Terminal opened: %s", terminalID)

	time.Sleep(1 * time.Second)
	assert.Equal(t, 1, a.Terminal.Count(), "terminal should be alive")

	// Write a test command
	_, err = a.Terminal.Write(terminalID, "echo APP_TEST_OK\n")
	require.NoError(t, err)
	time.Sleep(500 * time.Millisecond)
	assert.Equal(t, 1, a.Terminal.Count(), "terminal should still be alive after write")

	t.Logf("SUCCESS: Real SSH terminal test passed")
}
