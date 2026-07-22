package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionService_DeleteSessions(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	first, err := svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "a", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	second, err := svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "b", Host: "10.0.0.2", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	_, err = store.CreateTunnel(db, model.Tunnel{SessionID: first.ID, Name: "web", Type: model.TunnelLocal, LocalHost: "127.0.0.1", LocalPort: 8080, RemoteHost: "r", RemotePort: 80})
	require.NoError(t, err)

	impact, err := svc.SessionsDeleteImpact([]int64{first.ID, second.ID})
	require.NoError(t, err)
	assert.Equal(t, 1, impact.Tunnels)

	count, err := svc.DeleteSessions([]int64{first.ID, second.ID, first.ID})
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	sessions, err := svc.ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, sessions, 0)
	tunnels, err := store.ListTunnels(db)
	require.NoError(t, err)
	assert.Len(t, tunnels, 0)
}

func TestSessionService_DeleteSessionsValidation(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	_, err := svc.DeleteSessions(nil)
	require.Error(t, err)
	_, err = svc.DeleteSessions([]int64{0})
	require.Error(t, err)
	_, err = svc.DeleteSessions([]int64{999})
	require.Error(t, err)
}
