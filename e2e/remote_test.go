package e2e_test

import (
	"context"
	"testing"
	"time"

	"mssh/internal/model"

	"github.com/stretchr/testify/require"
)

func TestRemoteSSH(t *testing.T) {
	a := newTestApp(t)

	// Create session with REAL credentials
	s, err := a.Session.CreateSession(model.Session{
		Name: "remote-test", Host: "192.168.1.48", Port: 30022,
		Username: "root", AuthMethod: model.AuthPassword, Password: "root",
		KeepAlive: 30,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = a.Session.DeleteSession(s.ID) })
	t.Logf("Session created")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	terminalID, err := a.Terminal.Open(ctx, s.ID, 80, 24)
	if err != nil {
		t.Logf("FAILED: %v", err)
	} else {
		t.Logf("SUCCESS: %s", terminalID)
		a.Terminal.Close(terminalID)
	}
}
