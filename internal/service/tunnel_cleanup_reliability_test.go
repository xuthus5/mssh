package service

import (
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestTunnelServiceStopForSessionsUsesInMemoryOwnership(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessions := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTunnelService(db, sessions, newMockEventBus(), testutil.NewTestLogger())
	closed := false
	service.tunnels[1] = &TunnelState{
		ID: 1, sessionID: 42,
		closed: func() error { closed = true; return nil },
	}
	require.NoError(t, db.Close())

	err := service.StopForSessions([]int64{42})

	require.NoError(t, err)
	assert.True(t, closed)
	assert.Empty(t, service.tunnels)
}

func TestTunnelServiceStopReturnsCleanupError(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessions := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTunnelService(db, sessions, bus, testutil.NewTestLogger())
	closeCalls := 0
	service.tunnels[1] = &TunnelState{
		ID: 1, sessionID: 42,
		closed: func() error {
			closeCalls++
			if closeCalls == 1 {
				return assert.AnError
			}
			return nil
		},
	}

	err := service.Stop(1)

	assert.ErrorIs(t, err, assert.AnError)
	assert.Contains(t, service.tunnels, int64(1))
	assert.Empty(t, bus.Events())
	require.NoError(t, service.Stop(1))
	assert.Empty(t, service.tunnels)
	assert.Len(t, bus.Events(), 1)
}

func TestTunnelServiceDeleteKeepsConfigWhenCleanupFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessions := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTunnelService(db, sessions, newMockEventBus(), testutil.NewTestLogger())
	session, err := sessions.CreateSession(model.SessionInputFrom(model.Session{
		Name: "tunnel-owner", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	tunnel, err := service.Create(model.TunnelInputFrom(model.Tunnel{
		SessionID: session.ID, Name: "dynamic", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}))
	require.NoError(t, err)
	closeCalls := 0
	service.tunnels[tunnel.ID] = &TunnelState{
		ID: tunnel.ID, sessionID: session.ID,
		closed: func() error {
			closeCalls++
			if closeCalls == 1 {
				return assert.AnError
			}
			return nil
		},
	}

	err = service.Delete(tunnel.ID)

	assert.ErrorIs(t, err, assert.AnError)
	assert.Contains(t, service.tunnels, tunnel.ID)
	remaining, listErr := store.ListTunnels(db)
	require.NoError(t, listErr)
	assert.Len(t, remaining, 1)
	require.NoError(t, service.Delete(tunnel.ID))
	remaining, listErr = store.ListTunnels(db)
	require.NoError(t, listErr)
	assert.Empty(t, remaining)
}

func TestTunnelServiceStopForSessionsRetainsFailedCleanup(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessions := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTunnelService(db, sessions, newMockEventBus(), testutil.NewTestLogger())
	service.tunnels[1] = &TunnelState{
		ID: 1, sessionID: 42,
		closed: func() error { return assert.AnError },
	}

	err := service.StopForSessions([]int64{42})

	assert.ErrorIs(t, err, assert.AnError)
	assert.Contains(t, service.tunnels, int64(1))
}

func TestTunnelServiceStopWaitsForStartingCleanup(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessions := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTunnelService(db, sessions, newMockEventBus(), testutil.NewTestLogger())
	state := &TunnelState{
		ID: 1, sessionID: 42, starting: true, startDone: make(chan struct{}),
	}
	service.tunnels[1] = state
	result := make(chan error, 1)
	go func() { result <- service.Stop(1) }()
	require.Eventually(t, func() bool {
		service.mu.Lock()
		defer service.mu.Unlock()
		return state.stopping
	}, time.Second, 10*time.Millisecond)

	select {
	case err := <-result:
		t.Fatalf("stop returned before start cleanup completed: %v", err)
	default:
	}
	service.finishTunnelStart(state, nil)
	require.NoError(t, <-result)
	assert.Empty(t, service.tunnels)
}

func TestTunnelServiceStopRetainsStartingCleanupFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessions := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTunnelService(db, sessions, newMockEventBus(), testutil.NewTestLogger())
	state := &TunnelState{
		ID: 1, sessionID: 42, starting: true, startDone: make(chan struct{}),
		closed: func() error { return nil },
	}
	service.tunnels[1] = state
	result := make(chan error, 1)
	go func() { result <- service.Stop(1) }()
	require.Eventually(t, func() bool {
		service.mu.Lock()
		defer service.mu.Unlock()
		return state.stopping
	}, time.Second, 10*time.Millisecond)

	service.finishTunnelStart(state, assert.AnError)
	assert.ErrorIs(t, <-result, assert.AnError)
	assert.Contains(t, service.tunnels, int64(1))
	require.NoError(t, service.Stop(1))
	assert.Empty(t, service.tunnels)
}

func TestTunnelServiceCommitRejectsStoppingReservation(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessions := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTunnelService(db, sessions, bus, testutil.NewTestLogger())
	state := &TunnelState{ID: 1, sessionID: 42, starting: true, stopping: true}
	service.tunnels[1] = state

	committed := service.commitTunnelStart(1, state, "conn", func() error { return nil })

	assert.False(t, committed)
	assert.Empty(t, state.connID)
	assert.Empty(t, bus.Events())
}

func TestTunnelServiceStopAndDeleteTimeoutRejectLateStartCommit(t *testing.T) {
	previousTimeout := tunnelStartCleanupTimeout
	tunnelStartCleanupTimeout = time.Millisecond
	t.Cleanup(func() { tunnelStartCleanupTimeout = previousTimeout })

	operations := []struct {
		name string
		run  func(*TunnelService, int64) error
	}{
		{name: "stop", run: func(service *TunnelService, tunnelID int64) error { return service.Stop(tunnelID) }},
		{name: "delete", run: func(service *TunnelService, tunnelID int64) error { return service.Delete(tunnelID) }},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			service := newTunnelCleanupTestService(t)
			state := &TunnelState{
				ID: 1, sessionID: 42, starting: true, startDone: make(chan struct{}),
			}
			service.tunnels[state.ID] = state

			err := operation.run(service, state.ID)

			require.ErrorContains(t, err, "start cleanup timed out")
			committed := service.commitTunnelStart(state.ID, state, "late-conn", func() error { return nil })
			assert.False(t, committed)
			assert.Empty(t, service.eventBus.(*mockEventBus).Events())
		})
	}
}

func TestTunnelServiceStopTreatsClosedListenerAsClean(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessions := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTunnelService(db, sessions, newMockEventBus(), testutil.NewTestLogger())
	service.tunnels[1] = &TunnelState{
		ID: 1, sessionID: 42, closed: func() error { return net.ErrClosed },
	}

	require.NoError(t, service.Stop(1))
	assert.Empty(t, service.tunnels)
}

type failingSessionTunnelStopper struct{}

func (failingSessionTunnelStopper) StopForSessions([]int64) error {
	return assert.AnError
}

func TestSessionServiceDeleteKeepsSessionWhenTunnelCleanupFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service.SetTunnelStopper(failingSessionTunnelStopper{})
	session, err := service.CreateSession(model.SessionInputFrom(model.Session{
		Name: "keep-on-cleanup-error", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)

	err = service.DeleteSession(session.ID)

	assert.ErrorIs(t, err, assert.AnError)
	_, getErr := store.GetSession(db, session.ID)
	require.NoError(t, getErr)
}
