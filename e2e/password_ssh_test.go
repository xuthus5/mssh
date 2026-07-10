package e2e_test

import (
	"context"
	"testing"
	"time"

	"mssh/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPasswordSSH(t *testing.T) {
	a := newTestApp(t)

	s, err := a.Session.CreateSession(model.Session{
		Name: "pwd-ssh-test", Host: "127.0.0.1", Port: 30022,
		Username: "root", AuthMethod: model.AuthPassword, Password: "testpass123",
		KeepAlive: 30,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = a.Session.DeleteSession(s.ID) })
	t.Logf("Session created id=%d", s.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	terminalID, err := a.Terminal.Open(ctx, s.ID, 80, 24)
	require.NoError(t, err)
	t.Cleanup(func() { _ = a.Terminal.Close(terminalID) })
	t.Logf("Password SSH terminal opened: %s", terminalID)

	time.Sleep(1 * time.Second)
	assert.Equal(t, 1, a.Terminal.Count(), "terminal alive")

	_, err = a.Terminal.Write(terminalID, []byte("echo PASSWORD_SSH_OK\n"))
	require.NoError(t, err)
	t.Logf("Command written to terminal")

	time.Sleep(500 * time.Millisecond)
	assert.Equal(t, 1, a.Terminal.Count(), "terminal still alive after write")
	t.Logf("Password SSH test PASSED")
}
