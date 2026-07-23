package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestSessionService_DeleteSessionStopsRunningTunnels(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	tunnelSvc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())
	sessionSvc.SetTunnelStopper(tunnelSvc)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	session, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "with-tunnel", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)

	tunnel, err := tunnelSvc.Create(model.TunnelInputFrom(model.Tunnel{
		SessionID: session.ID, Name: "socks", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}))
	require.NoError(t, err)
	require.NoError(t, tunnelSvc.Start(tunnel.ID))
	require.Equal(t, 1, sessionSvc.ConnectionCount())

	require.NoError(t, sessionSvc.DeleteSession(session.ID))
	assert.Equal(t, 0, sessionSvc.ConnectionCount())

	// DB rows removed
	remaining, err := tunnelSvc.List()
	require.NoError(t, err)
	assert.Len(t, remaining, 0)

	// Stopped event emitted for the live tunnel
	foundStopped := false
	for _, item := range bus.Events() {
		if item.Name != event.TunnelState {
			continue
		}
		payload, ok := item.Payload.(event.ConnectionStatePayload)
		if ok && payload.State == "stopped" {
			foundStopped = true
		}
	}
	assert.True(t, foundStopped)
}

func TestSessionService_DeleteSessionsStopsRunningTunnels(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	tunnelSvc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())
	sessionSvc.SetTunnelStopper(tunnelSvc)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	first, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "a", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	second, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "b", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)

	firstTunnel, err := tunnelSvc.Create(model.TunnelInputFrom(model.Tunnel{
		SessionID: first.ID, Name: "one", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}))
	require.NoError(t, err)
	secondTunnel, err := tunnelSvc.Create(model.TunnelInputFrom(model.Tunnel{
		SessionID: second.ID, Name: "two", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}))
	require.NoError(t, err)
	require.NoError(t, tunnelSvc.Start(firstTunnel.ID))
	require.NoError(t, tunnelSvc.Start(secondTunnel.ID))
	require.Equal(t, 2, sessionSvc.ConnectionCount())

	count, err := sessionSvc.DeleteSessions([]int64{first.ID, second.ID})
	require.NoError(t, err)
	assert.Equal(t, 2, count)
	assert.Equal(t, 0, sessionSvc.ConnectionCount())
}
