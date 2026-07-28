package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestTunnelServiceSessionDeletionGuardBlocksReservations(t *testing.T) {
	service := newTunnelCleanupTestService(t)

	service.beginSessionDeletion([]int64{0, -1, 42})
	_, err := service.reserveTunnel(1, 42)
	assert.ErrorContains(t, err, "session deletion in progress")

	other, err := service.reserveTunnel(2, 99)
	require.NoError(t, err)
	service.releaseTunnelReservation(2, other)

	service.endSessionDeletion([]int64{42})
	reservation, err := service.reserveTunnel(1, 42)
	require.NoError(t, err)
	service.releaseTunnelReservation(1, reservation)
}

func TestTunnelServiceSessionDeletionGuardIsReferenceCounted(t *testing.T) {
	service := newTunnelCleanupTestService(t)

	service.beginSessionDeletion([]int64{42})
	service.beginSessionDeletion([]int64{42})
	service.endSessionDeletion([]int64{42})
	_, err := service.reserveTunnel(1, 42)
	assert.ErrorContains(t, err, "session deletion in progress")

	service.endSessionDeletion([]int64{0, -1, 42})
	reservation, err := service.reserveTunnel(1, 42)
	require.NoError(t, err)
	service.releaseTunnelReservation(1, reservation)
}

type trackingTunnelDeletionGuard struct {
	active     bool
	stopCalled bool
	beginCalls int
	endCalls   int
	stopErr    error
}

func (g *trackingTunnelDeletionGuard) beginSessionDeletion([]int64) {
	g.active = true
	g.beginCalls++
}

func (g *trackingTunnelDeletionGuard) endSessionDeletion([]int64) {
	g.active = false
	g.endCalls++
}

func (g *trackingTunnelDeletionGuard) StopForSessions([]int64) error {
	g.stopCalled = g.active
	return g.stopErr
}

func TestSessionServiceDeleteUsesTunnelDeletionGuard(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	guard := &trackingTunnelDeletionGuard{stopErr: assert.AnError}
	service.SetTunnelStopper(guard)
	session := createTunnelGuardSession(t, service, "guard-single")

	err := service.DeleteSession(session.ID)

	assert.ErrorIs(t, err, assert.AnError)
	assert.True(t, guard.stopCalled)
	assert.Equal(t, 1, guard.beginCalls)
	assert.Equal(t, 1, guard.endCalls)
	assert.False(t, guard.active)
}

func TestSessionServiceDeleteSessionsUsesTunnelDeletionGuard(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	guard := &trackingTunnelDeletionGuard{}
	service.SetTunnelStopper(guard)
	first := createTunnelGuardSession(t, service, "guard-batch-1")
	second := createTunnelGuardSession(t, service, "guard-batch-2")

	deleted, err := service.DeleteSessions([]int64{first.ID, second.ID})

	require.NoError(t, err)
	assert.Equal(t, 2, deleted)
	assert.True(t, guard.stopCalled)
	assert.Equal(t, 1, guard.beginCalls)
	assert.Equal(t, 1, guard.endCalls)
	assert.False(t, guard.active)
}

func createTunnelGuardSession(t *testing.T, service *SessionService, name string) *model.Session {
	t.Helper()
	session, err := service.CreateSession(model.SessionInputFrom(model.Session{
		Name: name, Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	return session
}
