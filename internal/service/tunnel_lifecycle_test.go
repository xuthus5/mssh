package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestTunnelShutdownWaitsForActiveList(t *testing.T) {
	database := testutil.NewTestDB(t)
	tunnelService := NewTunnelService(database, nil, newMockEventBus(), testutil.NewTestLogger())
	assertDatabaseServiceShutdownWaits(t, database, func() error {
		_, err := tunnelService.List()
		return err
	}, func() { require.NoError(t, tunnelService.Shutdown()) })
}

func TestTunnelShutdownRejectsPublicOperations(t *testing.T) {
	tunnelService := NewTunnelService(testutil.NewTestDB(t), nil, newMockEventBus(), testutil.NewTestLogger())
	require.NoError(t, tunnelService.Shutdown())
	require.NoError(t, tunnelService.Shutdown())

	_, err := tunnelService.List()
	assertTunnelStopped(t, err)
	_, err = tunnelService.Create(model.TunnelInput{})
	assertTunnelStopped(t, err)
	assertTunnelStopped(t, tunnelService.Update(model.TunnelInput{}))
	assertTunnelStopped(t, tunnelService.Delete(1))
	assertTunnelStopped(t, tunnelService.Start(1))
	assertTunnelStopped(t, tunnelService.Stop(1))
}

func TestTunnelShutdownHandlesNilReceiver(t *testing.T) {
	var tunnelService *TunnelService
	assert.NotPanics(t, tunnelService.StopOperations)
	assert.NotPanics(t, tunnelService.WaitOperations)
	require.NoError(t, tunnelService.StopAllWithError())
	require.NoError(t, tunnelService.Shutdown())
	_, err := tunnelService.List()
	assertTunnelStopped(t, err)
}

func TestTunnelStopAllWaitsForInFlightStartBeforeSnapshot(t *testing.T) {
	database := testutil.NewTestDB(t)
	tunnelService := NewTunnelService(database, nil, newMockEventBus(), testutil.NewTestLogger())
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	startDone := make(chan error, 1)
	go func() { startDone <- tunnelService.Start(1) }()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	stopDone := make(chan struct{})
	go func() {
		tunnelService.StopAll()
		close(stopDone)
	}()
	select {
	case <-stopDone:
		t.Fatal("StopAll returned before the in-flight start left its reservation boundary")
	case <-time.After(50 * time.Millisecond):
	}
	rollback()
	require.Error(t, <-startDone)
	select {
	case <-stopDone:
	case <-time.After(time.Second):
		t.Fatal("StopAll did not finish after the in-flight start returned")
	}
	assert.Empty(t, tunnelService.tunnels)
}

func TestTunnelStopOperationsCancelsStartingReservation(t *testing.T) {
	tunnelService := NewTunnelService(testutil.NewTestDB(t), nil, newMockEventBus(), testutil.NewTestLogger())
	startContext, cancel := context.WithCancel(context.Background())
	state := &TunnelState{
		ID: 1, starting: true, startCtx: startContext, startCancel: cancel, startDone: make(chan struct{}),
	}
	tunnelService.tunnels[1] = state

	tunnelService.StopOperations()
	require.Eventually(t, func() bool { return startContext.Err() != nil }, time.Second, time.Millisecond)
	assert.True(t, state.stopping)
}

func TestTunnelUpdateRejectsActiveConfiguration(t *testing.T) {
	database := testutil.NewTestDB(t)
	sessionService := NewSessionService(database, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	session, err := sessionService.CreateSession(model.SessionInputFrom(model.Session{
		Name: "owner", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	tunnelService := NewTunnelService(database, sessionService, newMockEventBus(), testutil.NewTestLogger())
	created, err := tunnelService.Create(model.TunnelInputFrom(model.Tunnel{
		SessionID: session.ID, Name: "active", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}))
	require.NoError(t, err)
	tunnelService.tunnels[created.ID] = &TunnelState{ID: created.ID, sessionID: session.ID}

	err = tunnelService.Update(model.TunnelInputFrom(model.Tunnel{
		ID: created.ID, SessionID: session.ID, Name: "changed", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 1080,
	}))
	require.Error(t, err)
	assert.ErrorContains(t, err, "in use")
}

func TestTunnelRuntimeBarrierReportsTemporaryAndPermanentClose(t *testing.T) {
	tunnelService := NewTunnelService(testutil.NewTestDB(t), nil, newMockEventBus(), testutil.NewTestLogger())
	tunnelService.mu.Lock()
	tunnelService.closing = true
	tunnelService.mu.Unlock()
	_, err := tunnelService.beginRuntimeOperation()
	assert.ErrorIs(t, err, errTunnelRuntimeClosing)

	tunnelService.mu.Lock()
	tunnelService.shuttingDown = true
	tunnelService.mu.Unlock()
	_, err = tunnelService.beginRuntimeOperation()
	assert.ErrorIs(t, err, errTunnelServiceStopped)
	tunnelService.cancelTunnelStart(nil)
}

func TestTunnelFailedStartConnectionCleanupClearsReservation(t *testing.T) {
	database := testutil.NewTestDB(t)
	sessionService := NewSessionService(database, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	tunnelService := NewTunnelService(database, sessionService, newMockEventBus(), testutil.NewTestLogger())
	sessionService.conns["conn-1"] = &managedConn{}
	reservation := &TunnelState{connID: "conn-1"}

	require.NoError(t, tunnelService.cleanupFailedTunnelStartConnection(reservation, "conn-1"))
	assert.Empty(t, reservation.connID)
	reservation.connID = "missing"
	err := tunnelService.cleanupFailedTunnelStartConnection(reservation, "missing")
	require.Error(t, err)
	assert.Empty(t, reservation.connID)
}

func TestTunnelCancelledStartCleanupSynchronizesRetryState(t *testing.T) {
	tunnelService := NewTunnelService(testutil.NewTestDB(t), nil, newMockEventBus(), testutil.NewTestLogger())
	reservation := &TunnelState{connID: "old", closed: func() error { return nil }}
	cleanupState := &TunnelState{}
	tunnelService.syncTunnelStartCleanup(reservation, cleanupState, nil)
	assert.Empty(t, reservation.connID)
	assert.Nil(t, reservation.closed)

	cleanupState = &TunnelState{connID: "retry", closed: func() error { return nil }}
	tunnelService.syncTunnelStartCleanup(reservation, cleanupState, assert.AnError)
	assert.Equal(t, "retry", reservation.connID)
	assert.NotNil(t, reservation.closed)
}

func TestTunnelCancelledStartReleasesCleanLateReservation(t *testing.T) {
	tunnelService := NewTunnelService(testutil.NewTestDB(t), nil, newMockEventBus(), testutil.NewTestLogger())
	reservation := &TunnelState{
		ID: 1, starting: true, startCancelled: true, startDone: make(chan struct{}),
	}
	tunnelService.tunnels[reservation.ID] = reservation
	tunnelService.syncTunnelStartCleanup(reservation, &TunnelState{}, nil)

	tunnelService.finishTunnelStart(reservation, nil)

	assert.NotContains(t, tunnelService.tunnels, reservation.ID)
}

func assertTunnelStopped(t *testing.T, err error) {
	t.Helper()
	assertServiceStoppedError(t, err, "tunnel service is shutting down")
}
