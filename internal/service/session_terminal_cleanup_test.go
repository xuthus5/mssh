package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestSessionService_DeleteSessionClosesTerminals(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	termSvc := NewTerminalService(sessionSvc, bus, 32, testutil.NewTestLogger())
	sessionSvc.SetTerminalCloser(termSvc)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	session, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "live-term", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)

	terminalID, err := termSvc.Open(context.Background(), session.ID, 80, 24)
	require.NoError(t, err)
	require.Equal(t, 1, termSvc.Count())
	require.Equal(t, 1, sessionSvc.ConnectionCount())

	require.NoError(t, sessionSvc.DeleteSession(session.ID))

	assert.Equal(t, 0, termSvc.Count())
	assert.Equal(t, 0, sessionSvc.ConnectionCount())

	foundClosed := false
	for _, item := range bus.Events() {
		if item.Name != event.TerminalClosed {
			continue
		}
		payload, ok := item.Payload.(event.ConnectionStatePayload)
		if ok && payload.TerminalID == terminalID && payload.State == "closed" {
			foundClosed = true
		}
	}
	assert.True(t, foundClosed)
}

func TestTerminalService_CloseForSessionsOnlyMatchesOwned(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	termSvc := NewTerminalService(sessionSvc, bus, 32, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	keep, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "keep", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	drop, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "drop", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)

	keepID, err := termSvc.Open(context.Background(), keep.ID, 80, 24)
	require.NoError(t, err)
	dropID, err := termSvc.Open(context.Background(), drop.ID, 80, 24)
	require.NoError(t, err)

	require.NoError(t, termSvc.CloseForSessions([]int64{drop.ID}))
	assert.Equal(t, 1, termSvc.Count())
	_, keepOK := termSvc.ptys[keepID]
	_, dropOK := termSvc.ptys[dropID]
	assert.True(t, keepOK)
	assert.False(t, dropOK)
	// cleanup leftover
	require.NoError(t, termSvc.Close(keepID))
}

func TestSessionService_DeleteSessionRetainsRowWhenTerminalCloseFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	termSvc := NewTerminalService(sessionSvc, bus, 32, testutil.NewTestLogger())
	sessionSvc.SetTerminalCloser(termSvc)
	session, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "close-error", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	closeErr := errors.New("pty close failed")
	termSvc.mu.Lock()
	termSvc.ptys["term-close-error"] = &stubTerminalIO{closeErr: closeErr}
	termSvc.sessionIDs["term-close-error"] = session.ID
	termSvc.lastUsed["term-close-error"] = time.Now()
	termSvc.mu.Unlock()

	err = sessionSvc.DeleteSession(session.ID)

	require.ErrorIs(t, err, closeErr)
	_, getErr := sessionSvc.GetSession(session.ID)
	require.NoError(t, getErr)
}

func TestSessionService_DeleteSessionClearsDetachedPendingTerminal(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	termSvc := NewTerminalService(sessionSvc, bus, 32, testutil.NewTestLogger())
	sessionSvc.SetTerminalCloser(termSvc)
	session, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "detached-pending", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	terminal := &stubTerminalIO{}
	termSvc.mu.Lock()
	termSvc.ptys["detached-pending"] = terminal
	termSvc.sessionIDs["detached-pending"] = session.ID
	termSvc.pendingOutput["detached-pending"] = []byte("tail output")
	termSvc.lastUsed["detached-pending"] = time.Now()
	termSvc.mu.Unlock()
	termSvc.handlePTYExit("detached-pending", terminal, nil)

	require.Equal(t, session.ID, termSvc.pendingSessionIDs["detached-pending"])
	require.NoError(t, sessionSvc.DeleteSession(session.ID))

	assert.NotContains(t, termSvc.pendingOutput, "detached-pending")
	assert.NotContains(t, termSvc.pendingSessionIDs, "detached-pending")
	assert.NotContains(t, termSvc.pendingExpiries, "detached-pending")
}

func TestSessionService_DisconnectForSessionsCleansResidualConns(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	// Inject residual connection without going through TerminalService.
	sessionSvc.mu.Lock()
	sessionSvc.conns["residual"] = &managedConn{sessionID: 42, cleanup: func() {}}
	sessionSvc.mu.Unlock()
	require.Equal(t, 1, sessionSvc.ConnectionCount())

	require.NoError(t, sessionSvc.DisconnectForSessions([]int64{42}))
	assert.Equal(t, 0, sessionSvc.ConnectionCount())
	// no-op for empty / unmatched
	require.NoError(t, sessionSvc.DisconnectForSessions(nil))
	require.NoError(t, sessionSvc.DisconnectForSessions([]int64{0, -1}))
	_ = time.Second
}

func TestSessionService_DeleteSessionRetainsRowWhenResidualDisconnectFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	session, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "disconnect-error", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	closeErr := errors.New("residual SSH close failed")
	client := newFailingSSHClient(closeErr)
	sessionSvc.mu.Lock()
	sessionSvc.conns["residual-close-error"] = &managedConn{
		wrapper: &ssh.ClientWrapper{Inner: client}, sessionID: session.ID,
	}
	sessionSvc.mu.Unlock()

	err = sessionSvc.DeleteSession(session.ID)

	require.ErrorIs(t, err, closeErr)
	_, getErr := sessionSvc.GetSession(session.ID)
	require.NoError(t, getErr)
}

func TestSessionService_DeletionGuardBlocksNewAndLateConnections(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	session, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "deletion-guard", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	_, _, generation, finish, err := sessionSvc.beginConnect(context.Background(), session.ID)
	require.NoError(t, err)

	release := sessionSvc.beginSessionDeletion([]int64{session.ID})
	_, connectErr := sessionSvc.connect(context.Background(), session.ID, false)
	assert.ErrorContains(t, connectErr, "session deletion in progress")
	release()

	_, registerErr := sessionSvc.registerConnectedSession(
		session.ID, generation, &managedConn{sessionID: session.ID},
	)
	assert.ErrorContains(t, registerErr, "session changed during connection")
	finish()
}

func TestSessionService_DeletionGuardIsReferenceCounted(t *testing.T) {
	service := NewSessionService(nil, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	firstRelease := service.beginSessionDeletion([]int64{42})
	secondRelease := service.beginSessionDeletion([]int64{42})
	firstRelease()

	_, _, _, finish, err := service.beginConnect(context.Background(), 42)
	assert.ErrorContains(t, err, "session deletion in progress")
	assert.Nil(t, finish)

	secondRelease()
	_, _, _, finish, err = service.beginConnect(context.Background(), 42)
	require.NoError(t, err)
	finish()
}

func TestTerminalService_DeletionGuardRejectsLateRegistration(t *testing.T) {
	termSvc := NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger())
	generation, err := termSvc.beginSessionOpen(42)
	require.NoError(t, err)

	termSvc.beginSessionDeletion([]int64{42})
	termSvc.endSessionDeletion([]int64{42})

	err = termSvc.registerSessionTerminal(terminalRegistration{
		terminalID: "late-terminal", connID: "late-connection", sessionID: 42,
		generation: generation, pty: &stubTerminalIO{},
	})
	assert.ErrorContains(t, err, "session changed during terminal open")
	assert.Equal(t, 0, termSvc.Count())
}

func TestTerminalService_DeletionGuardIsReferenceCounted(t *testing.T) {
	termSvc := NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger())
	termSvc.beginSessionDeletion([]int64{42})
	termSvc.beginSessionDeletion([]int64{42})
	termSvc.endSessionDeletion([]int64{42})

	_, err := termSvc.beginSessionOpen(42)
	assert.ErrorContains(t, err, "session deletion in progress")

	termSvc.endSessionDeletion([]int64{42})
	generation, err := termSvc.beginSessionOpen(42)
	require.NoError(t, err)
	assert.Equal(t, uint64(2), generation)
}

func TestSessionService_DeleteSessionCancelsConnectAttempts(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	session, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "connecting", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)

	cancelled := make(chan struct{})
	sessionSvc.mu.Lock()
	sessionSvc.attempts["attempt-live"] = &connectAttempt{
		cancel: func() { close(cancelled) }, decision: make(chan bool, 1), sessionID: session.ID,
	}
	sessionSvc.mu.Unlock()

	require.NoError(t, sessionSvc.DeleteSession(session.ID))
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("connect attempt was not cancelled")
	}
	sessionSvc.mu.RLock()
	_, exists := sessionSvc.attempts["attempt-live"]
	sessionSvc.mu.RUnlock()
	assert.False(t, exists)
}

func newFailingSSHClient(closeErr error) *gossh.Client {
	channels := make(chan gossh.NewChannel)
	requests := make(chan *gossh.Request)
	close(channels)
	close(requests)
	return gossh.NewClient(&failingSSHConn{closeErr: closeErr}, channels, requests)
}
