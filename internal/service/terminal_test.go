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

func TestNewTerminalService(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	bus := newMockEventBus()

	svc := NewTerminalService(sessionSvc, bus, 0, testutil.NewTestLogger())
	require.NotNil(t, svc)
	assert.Equal(t, 32, svc.maxSize)
	assert.NotNil(t, svc.ptys)
	assert.NotNil(t, svc.lastUsed)
	assert.NotNil(t, svc.attached)
	assert.NotNil(t, svc.pendingOutput)

	svc2 := NewTerminalService(sessionSvc, bus, 10, testutil.NewTestLogger())
	assert.Equal(t, 10, svc2.maxSize)
}

func TestTerminalService_Count(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger(),
		ptys:     make(map[string]terminalIO),
		lastUsed: make(map[string]time.Time),
	}
	assert.Equal(t, 0, svc.Count())

	svc.ptys["a"] = nil
	assert.Equal(t, 1, svc.Count())
}

func TestTerminalService_SetMaxSize(t *testing.T) {
	svc := NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger())
	require.NoError(t, svc.SetMaxSize(8))
	assert.Equal(t, 8, svc.maxSize)
	assert.Error(t, svc.SetMaxSize(0))
}

func TestTerminalService_Open(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-open", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	termBus := newMockEventBus()
	termSvc := NewTerminalService(sessionSvc, termBus, 32, testutil.NewTestLogger())
	ctx := context.Background()

	terminalID, err := termSvc.Open(ctx, created.ID, 80, 24)
	require.NoError(t, err)
	assert.NotEmpty(t, terminalID)

	assert.Equal(t, 1, termSvc.Count())
	_, ok := termSvc.ptys[terminalID]
	assert.True(t, ok)
	_, ok = termSvc.lastUsed[terminalID]
	assert.True(t, ok)
	assert.NotEmpty(t, termSvc.connIDs[terminalID])
	require.NoError(t, termSvc.Close(terminalID))
	assert.Equal(t, 0, sessionSvc.ConnectionCount())
}

func TestTerminalService_CloseInvokesCleanupHandler(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewTerminalService(sessionSvc, newMockEventBus(), 2, testutil.NewTestLogger())
	svc.ptys["term-1"] = nil
	svc.lastUsed["term-1"] = time.Now()

	closed := make(chan string, 1)
	svc.SetCloseHandler(func(terminalID string) { closed <- terminalID })
	require.NoError(t, svc.Close("term-1"))
	assert.Equal(t, "term-1", <-closed)
}

func TestTerminalService_OpenDefaultTermType(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-open-default", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "",
	}
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	termBus := newMockEventBus()
	termSvc := NewTerminalService(sessionSvc, termBus, 32, testutil.NewTestLogger())
	ctx := context.Background()

	terminalID, err := termSvc.Open(ctx, created.ID, 80, 24)
	require.NoError(t, err)
	assert.NotEmpty(t, terminalID)
	assert.Equal(t, 1, termSvc.Count())
}

func TestTerminalService_RemoteExitCleansTerminalAndEmitsDisconnectedState(t *testing.T) {
	db := testutil.NewTestDB(t)
	terminalBus := newMockEventBus()
	sessionSvc := NewSessionService(db, terminalBus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	addr, cleanup := sshtestutil.NewMockServerAutoLogout(t)
	defer cleanup()

	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "auto-logout", Host: "127.0.0.1", Port: parsePort(t, addr), Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)

	terminalSvc := NewTerminalService(sessionSvc, terminalBus, 32, testutil.NewTestLogger())
	closed := make(chan string, 1)
	terminalSvc.SetCloseHandler(func(terminalID string) { closed <- terminalID })

	terminalID, err := terminalSvc.Open(context.Background(), created.ID, 80, 24)
	require.NoError(t, err)

	require.Eventually(t, func() bool { return terminalSvc.Count() == 0 }, 2*time.Second, 10*time.Millisecond)
	require.Eventually(t, func() bool { return sessionSvc.ConnectionCount() == 0 }, 2*time.Second, 10*time.Millisecond)
	assert.Equal(t, terminalID, <-closed)
	_, err = terminalSvc.Write(terminalID, "whoami\n")
	assert.ErrorContains(t, err, "not found")

	require.Eventually(t, func() bool {
		for _, captured := range terminalBus.Events() {
			payload, ok := captured.Payload.(event.ConnectionStatePayload)
			if captured.Name == event.ConnectionState && ok && payload.TerminalID == terminalID && payload.State == "disconnected" {
				return true
			}
		}
		return false
	}, 2*time.Second, 10*time.Millisecond)

	var states []string
	for _, captured := range terminalBus.Events() {
		payload, ok := captured.Payload.(event.ConnectionStatePayload)
		if captured.Name == event.ConnectionState && ok {
			assert.Equal(t, terminalID, payload.TerminalID)
			states = append(states, payload.State)
		}
		assert.NotEqual(t, event.TerminalClosed, captured.Name)
	}
	assert.Equal(t, []string{"connected", "disconnected"}, states)
}

func TestTerminalService_ImmediateRemoteExitOrdersLifecycleAndCleans(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	addr, cleanup := sshtestutil.NewMockServerImmediateLogout(t)
	defer cleanup()
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "immediate-logout", Host: "127.0.0.1", Port: parsePort(t, addr), Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	terminalSvc := NewTerminalService(sessionSvc, bus, 32, testutil.NewTestLogger())

	terminalID, err := terminalSvc.Open(context.Background(), created.ID, 80, 24)
	require.NoError(t, err)
	assert.NotEmpty(t, terminalID)
	require.Eventually(t, func() bool { return terminalSvc.Count() == 0 }, 2*time.Second, 10*time.Millisecond)
	require.Eventually(t, func() bool { return sessionSvc.ConnectionCount() == 0 }, 2*time.Second, 10*time.Millisecond)
	require.Eventually(t, func() bool {
		for _, captured := range bus.Events() {
			payload, ok := captured.Payload.(event.ConnectionStatePayload)
			if captured.Name == event.ConnectionState && ok && payload.State == "disconnected" {
				return true
			}
		}
		return false
	}, 2*time.Second, 10*time.Millisecond)
	var states []string
	for _, captured := range bus.Events() {
		payload, ok := captured.Payload.(event.ConnectionStatePayload)
		if captured.Name == event.ConnectionState && ok {
			states = append(states, payload.State)
		}
	}
	assert.Equal(t, []string{"connected", "disconnected"}, states)
	require.NoError(t, terminalSvc.Attach(terminalID))
	lastEvent := bus.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TerminalOutput, lastEvent.Name)
	payload, ok := lastEvent.Payload.(event.TerminalOutputPayload)
	require.True(t, ok)
	assert.Contains(t, string(payload.Data), "auto-logout")
}

func TestTerminalService_OpenSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	termSvc := NewTerminalService(sessionSvc, newMockEventBus(), 32, testutil.NewTestLogger())

	ctx := context.Background()
	_, err := termSvc.Open(ctx, 999, 80, 24)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "terminal open")
}

func TestTerminalService_ReadCallback(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-cb", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm",
	}
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	termBus := newMockEventBus()
	termSvc := NewTerminalService(sessionSvc, termBus, 32, testutil.NewTestLogger())
	output := make(chan string, 4)
	termSvc.SetOutputHandler(func(_ string, data []byte) { output <- string(data) })
	ctx := context.Background()

	terminalID, err := termSvc.Open(ctx, created.ID, 80, 24)
	require.NoError(t, err)
	require.NoError(t, termSvc.Attach(terminalID))

	require.Eventually(t, func() bool {
		return termBus.hasEvent(event.TerminalOutput)
	}, 2*time.Second, 10*time.Millisecond, "read callback should emit TerminalOutput event")
	assert.NotEmpty(t, <-output)
}

func TestTerminalService_AttachNotFound(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger())
	assert.ErrorContains(t, service.Attach("missing"), "not found")
}
