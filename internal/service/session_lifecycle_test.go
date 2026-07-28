package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestSessionServiceCloseAllWaitsForInFlightConnect(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newManualHostKeyEventBus()
	service := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	address, stop := sshtestutil.NewMockServer(t)
	t.Cleanup(stop)
	session, err := service.CreateSession(model.SessionInputFrom(model.Session{
		Name: "close-all-connect", Host: "127.0.0.1", Port: parsePort(t, address),
		Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30,
	}))
	require.NoError(t, err)

	connectDone := make(chan error, 1)
	go func() {
		_, connectErr := service.connect(context.Background(), session.ID, false)
		connectDone <- connectErr
	}()
	require.Eventually(t, func() bool { return bus.hasEvent(event.HostKeyFingerprint) }, time.Second, 5*time.Millisecond)

	closeDone := make(chan error, 1)
	go func() { closeDone <- service.CloseAll() }()

	select {
	case closeErr := <-closeDone:
		require.NoError(t, closeErr)
	case <-time.After(time.Second):
		t.Fatal("CloseAll did not finish")
	}

	select {
	case connectErr := <-connectDone:
		require.Error(t, connectErr)
	case <-time.After(time.Second):
		t.Fatal("CloseAll returned before the in-flight connect finished")
	}
	assert.Equal(t, 0, service.ConnectionCount())
}

func TestSessionServiceCloseAllTemporarilyBlocksNewConnects(t *testing.T) {
	service := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	closeStarted := make(chan struct{})
	releaseClose := make(chan struct{})
	service.mu.Lock()
	service.conns["close-block"] = &managedConn{cleanup: func() {
		close(closeStarted)
		<-releaseClose
	}}
	service.mu.Unlock()

	closeDone := make(chan error, 1)
	go func() { closeDone <- service.CloseAll() }()
	<-closeStarted

	_, err := service.connect(context.Background(), 999, false)
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "shutting down"))

	close(releaseClose)
	require.NoError(t, <-closeDone)
	_, err = service.connect(context.Background(), 999, false)
	require.Error(t, err)
	assert.False(t, strings.Contains(err.Error(), "shutting down"))
}

func TestSessionServiceCloseAllRetainsFailedConnectionsForRetry(t *testing.T) {
	closeErr := errors.New("client close failed")
	retryableConnection := &retryableSSHConn{closeErr: closeErr}
	successfulConnection := &retryableSSHConn{}
	service := NewSessionService(nil, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	retryableManagedConnection := newManagedSSHConnection(retryableConnection)
	service.conns["retry"] = retryableManagedConnection
	service.conns["success"] = newManagedSSHConnection(successfulConnection)

	err := service.CloseAll()
	require.ErrorIs(t, err, closeErr)
	service.mu.RLock()
	retainedConnection := service.conns["retry"]
	_, successfulConnectionRegistered := service.conns["success"]
	service.mu.RUnlock()
	assert.Same(t, retryableManagedConnection, retainedConnection)
	assert.False(t, successfulConnectionRegistered)
	assert.Equal(t, 1, service.ConnectionCount())
	assert.Equal(t, 1, retryableConnection.CloseCalls())
	assert.Equal(t, 1, successfulConnection.CloseCalls())

	require.NoError(t, service.CloseAll())
	assert.Equal(t, 0, service.ConnectionCount())
	assert.Equal(t, 2, retryableConnection.CloseCalls())
	assert.Equal(t, 1, successfulConnection.CloseCalls())
}

func TestSessionServiceShutdownRejectsNewConnects(t *testing.T) {
	service := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	require.NoError(t, service.Shutdown())
	require.NoError(t, service.Shutdown())

	_, err := service.connect(context.Background(), 999, false)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "shutting down")
}

func TestSessionServiceShutdownRetainsFailedConnectionsForRetry(t *testing.T) {
	closeErr := errors.New("client close failed")
	retryableConnection := &retryableSSHConn{closeErr: closeErr}
	service := NewSessionService(nil, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service.conns["retry"] = newManagedSSHConnection(retryableConnection)

	err := service.Shutdown()
	require.ErrorIs(t, err, closeErr)
	assert.Equal(t, 1, service.ConnectionCount())
	assert.Equal(t, 1, retryableConnection.CloseCalls())

	require.NoError(t, service.Shutdown())
	assert.Equal(t, 0, service.ConnectionCount())
	assert.Equal(t, 2, retryableConnection.CloseCalls())
}

func TestSessionLifecycleNilAndCleanupBranches(t *testing.T) {
	var service *SessionService
	service.CancelConnectAttempts()
	require.NoError(t, service.Shutdown())
	require.NoError(t, service.CloseAll())

	active := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	require.NoError(t, active.closeManagedConnections(map[string]*managedConn{"nil": nil}))
	_, err := active.connect(nil, 999, false)
	require.Error(t, err)
	assert.False(t, errors.Is(err, context.Canceled))
}
