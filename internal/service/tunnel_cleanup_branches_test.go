package service

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestWaitTunnelStartCleanupReportsUnavailableAndTimeout(t *testing.T) {
	state := &TunnelState{ID: 7}
	assert.ErrorContains(t, waitTunnelStartCleanup(state), "completion is unavailable")

	state.startDone = make(chan struct{})
	err := waitTunnelStartCleanupWithin(state, time.Millisecond)
	assert.ErrorContains(t, err, "timed out")

	state.startErr = assert.AnError
	close(state.startDone)
	assert.ErrorIs(t, waitTunnelStartCleanupWithin(state, time.Second), assert.AnError)
}

func TestTunnelServiceStopRejectsUnavailableRuntimeStates(t *testing.T) {
	service := newTunnelCleanupTestService(t)

	assert.ErrorContains(t, service.Stop(0), "invalid tunnel id")
	assert.ErrorContains(t, service.Stop(1), "not running")

	service.tunnels[2] = nil
	assert.ErrorContains(t, service.Stop(2), "invalid runtime state")

	service.tunnels[3] = &TunnelState{ID: 3, stopping: true}
	assert.ErrorContains(t, service.Stop(3), "already in progress")
}

func TestTunnelServiceStopForSessionsHandlesMixedRuntimeStates(t *testing.T) {
	service := newTunnelCleanupTestService(t)
	closed := false
	service.tunnels[1] = nil
	service.tunnels[2] = &TunnelState{ID: 2, sessionID: 42, stopping: true}
	service.tunnels[3] = &TunnelState{
		ID: 3, sessionID: 42,
		closed: func() error { closed = true; return nil },
	}
	service.tunnels[4] = &TunnelState{ID: 4, sessionID: 99}

	err := service.StopForSessions([]int64{-1, 0, 42, 42})

	assert.ErrorContains(t, err, "cleanup already in progress")
	assert.True(t, closed)
	assert.NotContains(t, service.tunnels, int64(3))
	assert.Contains(t, service.tunnels, int64(2))
	assert.Contains(t, service.tunnels, int64(4))
	require.NoError(t, service.StopForSessions([]int64{0, -1}))
}

func TestTunnelServiceFinishCleanupProtectsReplacementState(t *testing.T) {
	service := newTunnelCleanupTestService(t)
	original := &TunnelState{ID: 1, stopping: true}
	replacement := &TunnelState{ID: 1, stopping: true}
	service.tunnels[1] = replacement

	service.finishTunnelCleanup(nil, true)
	service.finishTunnelCleanup(original, true)
	assert.Same(t, replacement, service.tunnels[1])

	service.finishTunnelCleanup(replacement, false)
	assert.False(t, replacement.stopping)
	service.finishTunnelCleanup(replacement, true)
	assert.Empty(t, service.tunnels)
}

func TestTunnelServiceStopRetriesAfterSessionDisconnectError(t *testing.T) {
	closeErr := errors.New("client close failed")
	channels := make(chan gossh.NewChannel)
	requests := make(chan *gossh.Request)
	close(channels)
	close(requests)
	client := gossh.NewClient(&retryableSSHConn{closeErr: closeErr}, channels, requests)
	bus := newMockEventBus()
	sessions := NewSessionService(nil, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	sessions.conns["conn-1"] = &managedConn{wrapper: &ssh.ClientWrapper{Inner: client}}
	service := NewTunnelService(nil, sessions, bus, testutil.NewTestLogger())
	state := &TunnelState{ID: 1, sessionID: 42, connID: "conn-1"}
	service.tunnels[1] = state

	err := service.Stop(1)

	assert.ErrorIs(t, err, closeErr)
	assert.Contains(t, service.tunnels, int64(1))
	assert.Equal(t, "conn-1", state.connID)
	assert.Equal(t, 1, sessions.ConnectionCount())
	assert.False(t, bus.hasEvent(event.TunnelState))
	require.NoError(t, service.Stop(1))
	assert.Empty(t, service.tunnels)
	assert.Zero(t, sessions.ConnectionCount())
	assert.True(t, bus.hasEvent(event.TunnelState))
}

func TestTunnelServiceCleanupHelpersPreserveRetryState(t *testing.T) {
	service := NewTunnelService(nil, nil, newMockEventBus(), testutil.NewTestLogger())
	state := &TunnelState{ID: 1, connID: "conn-1"}

	err := service.disconnectTunnelSession(state)
	assert.ErrorContains(t, err, "unavailable")
	assert.Equal(t, "conn-1", state.connID)
	assert.NoError(t, service.cleanupTunnelState(nil, true))
	assert.NoError(t, service.finalizeStoppedTunnel(nil, true))
	assert.NoError(t, service.closeTunnelListener(&TunnelState{}))
}

func TestTunnelStartCleanupHelpersCoverCancellationBranches(t *testing.T) {
	service := newTunnelCleanupTestService(t)
	reservation := &TunnelState{ID: 1, stopping: true}
	service.tunnels[1] = reservation

	service.releaseTunnelReservation(1, reservation)
	assert.Same(t, reservation, service.tunnels[1])
	service.finishTunnelStart(nil, nil)
	service.finishTunnelStart(&TunnelState{}, assert.AnError)

	preserveTunnelStartCleanup(nil, nil, nil)
	cleanup := &TunnelState{connID: "conn-1", closed: func() error { return nil }}
	preserveTunnelStartCleanup(reservation, cleanup, assert.AnError)
	assert.Equal(t, cleanup.connID, reservation.connID)
	assert.NotNil(t, reservation.closed)
	assert.NoError(t, service.disconnectFailedTunnelStart(""))
	assert.ErrorContains(t, service.disconnectFailedTunnelStart("missing"), "not found")
}

func TestTunnelServiceStopAllReturnsErrorAndRetainsFailedCleanup(t *testing.T) {
	service := newTunnelCleanupTestService(t)
	closeCalls := 0
	service.tunnels[1] = nil
	failedState := &TunnelState{
		ID: 2,
		closed: func() error {
			closeCalls++
			if closeCalls == 1 {
				return assert.AnError
			}
			return nil
		},
	}
	service.tunnels[2] = failedState

	err := service.StopAllWithError()

	assert.ErrorIs(t, err, assert.AnError)
	assert.Equal(t, 1, closeCalls)
	assert.Same(t, failedState, service.tunnels[2])
	assert.NotNil(t, failedState.closed)
	require.NoError(t, service.StopAllWithError())
	assert.Equal(t, 2, closeCalls)
	assert.Empty(t, service.tunnels)
}

func TestTunnelServiceAcceptExitIgnoresStoppingReservation(t *testing.T) {
	service := newTunnelCleanupTestService(t)
	state := &TunnelState{ID: 1, stopping: true}
	service.tunnels[1] = state

	service.handleAcceptLoopExit(1, state)

	assert.Same(t, state, service.tunnels[1])
	assert.Empty(t, service.eventBus.(*mockEventBus).Events())
}

func newTunnelCleanupTestService(t *testing.T) *TunnelService {
	t.Helper()
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessions := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	return NewTunnelService(db, sessions, bus, testutil.NewTestLogger())
}
