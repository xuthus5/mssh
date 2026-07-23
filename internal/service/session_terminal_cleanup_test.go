package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
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

	termSvc.CloseForSessions([]int64{drop.ID})
	assert.Equal(t, 1, termSvc.Count())
	_, keepOK := termSvc.ptys[keepID]
	_, dropOK := termSvc.ptys[dropID]
	assert.True(t, keepOK)
	assert.False(t, dropOK)
	// cleanup leftover
	require.NoError(t, termSvc.Close(keepID))
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

	sessionSvc.DisconnectForSessions([]int64{42})
	assert.Equal(t, 0, sessionSvc.ConnectionCount())
	// no-op for empty / unmatched
	sessionSvc.DisconnectForSessions(nil)
	sessionSvc.DisconnectForSessions([]int64{0, -1})
	_ = time.Second
}
