package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestTunnelServiceTransportLossStopsRuntimeAndEmitsState(t *testing.T) {
	database := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessions := NewSessionService(database, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	address, disconnect, stop := sshtestutil.NewMockServerIgnoringGlobalRequests(t)
	t.Cleanup(stop)
	session, err := sessions.CreateSession(model.SessionInputFrom(model.Session{
		Name: "transport-loss", Host: "127.0.0.1", Port: parsePort(t, address), Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 3600, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	tunnels := NewTunnelService(database, sessions, bus, testutil.NewTestLogger())
	tunnel, err := tunnels.Create(model.TunnelInputFrom(model.Tunnel{
		SessionID: session.ID, Name: "dynamic", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}))
	require.NoError(t, err)
	require.NoError(t, tunnels.Start(tunnel.ID))
	require.Equal(t, 1, sessions.ConnectionCount())

	disconnect()

	require.Eventually(t, func() bool {
		tunnels.mu.Lock()
		_, active := tunnels.tunnels[tunnel.ID]
		tunnels.mu.Unlock()
		return !active && sessions.ConnectionCount() == 0
	}, time.Second, 10*time.Millisecond)
	assert.True(t, hasTunnelState(bus.Events(), "stopped"))
}

func hasTunnelState(events []CapturedEvent, state string) bool {
	for _, captured := range events {
		payload, ok := captured.Payload.(event.ConnectionStatePayload)
		if captured.Name == event.TunnelState && ok && payload.State == state {
			return true
		}
	}
	return false
}
