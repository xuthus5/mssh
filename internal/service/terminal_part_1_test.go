package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/ssh"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestTerminalService_Write(t *testing.T) {
	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	s := model.Session{Host: "127.0.0.1", Port: port, Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, err := ssh.Connect(ctx, s, nil, sshtestutil.KnownHostsPath(t), nil)
	require.NoError(t, err)
	defer cw.Close()

	pty, err := ssh.OpenPTY(cw, s.TermType, 80, 24)
	require.NoError(t, err)
	defer pty.Close()

	svc := &TerminalService{logger: testutil.NewTestLogger(),
		eventBus: newMockEventBus(),
		ptys:     map[string]terminalIO{"term-1": pty},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}

	n, err := svc.Write("term-1", "ls\n")
	require.NoError(t, err)
	assert.Equal(t, 3, n)
}

func TestTerminalService_WriteNotFound(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger(),
		ptys:     make(map[string]terminalIO),
		lastUsed: make(map[string]time.Time),
	}

	_, err := svc.Write("nonexistent", "data")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestTerminalService_Resize(t *testing.T) {
	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	s := model.Session{Host: "127.0.0.1", Port: port, Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, err := ssh.Connect(ctx, s, nil, sshtestutil.KnownHostsPath(t), nil)
	require.NoError(t, err)
	defer cw.Close()

	pty, err := ssh.OpenPTY(cw, s.TermType, 80, 24)
	require.NoError(t, err)
	defer pty.Close()

	svc := &TerminalService{logger: testutil.NewTestLogger(),
		eventBus: newMockEventBus(),
		ptys:     map[string]terminalIO{"term-1": pty},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}

	err = svc.Resize("term-1", 120, 40)
	require.NoError(t, err)
}

func TestTerminalService_ResizeNotFound(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger(),
		ptys:     make(map[string]terminalIO),
		lastUsed: make(map[string]time.Time),
	}

	err := svc.Resize("nonexistent", 120, 40)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestTerminalService_Close(t *testing.T) {
	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	s := model.Session{Host: "127.0.0.1", Port: port, Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, err := ssh.Connect(ctx, s, nil, sshtestutil.KnownHostsPath(t), nil)
	require.NoError(t, err)
	defer cw.Close()

	pty, err := ssh.OpenPTY(cw, s.TermType, 80, 24)
	require.NoError(t, err)

	bus := newMockEventBus()
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	svc := &TerminalService{logger: testutil.NewTestLogger(),
		eventBus:   bus,
		sessionSvc: sessionSvc,
		ptys:       map[string]terminalIO{"term-1": pty},
		lastUsed:   map[string]time.Time{"term-1": time.Now()},
	}

	sessionSvc.mu.Lock()
	sessionSvc.conns["term-1"] = &managedConn{wrapper: cw}
	sessionSvc.mu.Unlock()

	err = svc.Close("term-1")
	require.NoError(t, err)

	assert.Equal(t, 0, svc.Count())

	lastEvent := bus.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TerminalClosed, lastEvent.Name)
	payload, ok := lastEvent.Payload.(event.ConnectionStatePayload)
	require.True(t, ok)
	assert.Equal(t, "term-1", payload.TerminalID)
	assert.Equal(t, "closed", payload.State)
}

func TestTerminalService_CloseNotFound(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger(),
		ptys:     make(map[string]terminalIO),
		lastUsed: make(map[string]time.Time),
	}

	err := svc.Close("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestTerminalService_EvictLRU(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	svc := &TerminalService{logger: testutil.NewTestLogger(),
		eventBus:   newMockEventBus(),
		sessionSvc: sessionSvc,
		ptys:       make(map[string]terminalIO),
		lastUsed:   make(map[string]time.Time),
		maxSize:    3,
	}

	svc.ptys["oldest"] = nil
	svc.ptys["middle"] = nil
	svc.ptys["newest"] = nil
	svc.lastUsed["oldest"] = time.Now().Add(-10 * time.Minute)
	svc.lastUsed["middle"] = time.Now().Add(-5 * time.Minute)
	svc.lastUsed["newest"] = time.Now()

	assert.Equal(t, 3, svc.Count())

	svc.evictLRU()

	assert.Equal(t, 2, svc.Count())
	_, exists := svc.ptys["oldest"]
	assert.False(t, exists, "oldest entry should be evicted")
	_, exists = svc.ptys["middle"]
	assert.True(t, exists, "middle entry should remain")
	_, exists = svc.ptys["newest"]
	assert.True(t, exists, "newest entry should remain")
}

func TestTerminalService_PoolLimitEnforcement(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-pool", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm",
	}
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	termBus := newMockEventBus()
	termSvc := NewTerminalService(sessionSvc, termBus, 3, testutil.NewTestLogger())
	ctx := context.Background()

	id1, err := termSvc.Open(ctx, created.ID, 80, 24)
	require.NoError(t, err)
	assert.NotEmpty(t, id1)
	assert.Equal(t, 1, termSvc.Count())

	id2, err := termSvc.Open(ctx, created.ID, 80, 24)
	require.NoError(t, err)
	assert.Equal(t, 2, termSvc.Count())

	id3, err := termSvc.Open(ctx, created.ID, 80, 24)
	require.NoError(t, err)
	assert.Equal(t, 3, termSvc.Count())

	time.Sleep(time.Millisecond * 10)

	id4, err := termSvc.Open(ctx, created.ID, 80, 24)
	require.NoError(t, err)
	assert.NotEmpty(t, id4)

	assert.Equal(t, 3, termSvc.Count(), "pool should not exceed maxSize")

	_, err = termSvc.Write(id1, "x")
	assert.Error(t, err, "evicted terminal should not be writable")

	_ = id2
	_ = id3
}

func TestSessionService_GetClientWrapper(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	_, err := svc.GetClientWrapper("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-gcw", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm",
	}
	created, err := svc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	ctx := context.Background()
	connID, err := svc.connect(ctx, created.ID, true)
	require.NoError(t, err)

	wrapper, err := svc.GetClientWrapper(connID)
	require.NoError(t, err)
	assert.NotNil(t, wrapper)
}

func TestSessionService_GetClientWrapperRejectsEmptyID(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	_, err := svc.GetClientWrapper("")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid connection id")
}
