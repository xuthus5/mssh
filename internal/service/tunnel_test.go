package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestNewTunnelService(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	bus := newMockEventBus()
	svc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())
	assert.NotNil(t, svc)
	assert.NotNil(t, svc.tunnels)
	assert.Equal(t, 0, len(svc.tunnels))
}

func TestTunnelService_List(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	tunnels, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, tunnels, 0)
}

func TestTunnelService_CRUD(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	sess := model.Session{
		Name: "test", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "web", Type: model.TunnelLocal,
		LocalHost: "127.0.0.1", LocalPort: 8080, RemoteHost: "remote", RemotePort: 80,
	}
	created, err := svc.Create(model.TunnelInputFrom(tunnel))
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "web", created.Name)

	list, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, list, 1)

	created.Name = "api"
	err = svc.Update(model.TunnelInputFrom(*created))
	require.NoError(t, err)

	list, err = svc.List()
	require.NoError(t, err)
	assert.Equal(t, "api", list[0].Name)

	err = svc.Delete(created.ID)
	require.NoError(t, err)

	list, err = svc.List()
	require.NoError(t, err)
	assert.Len(t, list, 0)
}

func TestTunnelService_StartStop(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-tunnel", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	svc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "socks", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}
	created, err := svc.Create(model.TunnelInputFrom(tunnel))
	require.NoError(t, err)

	err = svc.Start(created.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, sessionSvc.ConnectionCount())

	events := bus.Events()
	assert.GreaterOrEqual(t, len(events), 2)
	foundRunning := false
	for _, e := range events {
		if e.Name == event.TunnelState {
			payload, ok := e.Payload.(event.ConnectionStatePayload)
			if ok && payload.State == "running" {
				foundRunning = true
			}
		}
	}
	assert.True(t, foundRunning)

	err = svc.Stop(created.ID)
	require.NoError(t, err)
	assert.Equal(t, 0, sessionSvc.ConnectionCount())

	events = bus.Events()
	foundStopped := false
	for _, e := range events {
		if e.Name == event.TunnelState {
			payload, ok := e.Payload.(event.ConnectionStatePayload)
			if ok && payload.State == "stopped" {
				foundStopped = true
			}
		}
	}
	assert.True(t, foundStopped)
	for _, captured := range events {
		assert.NotEqual(t, event.ConnectionState, captured.Name)
	}
}

func TestTunnelService_StartNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err := svc.Start(999)
	assert.Error(t, err)
}

func TestTunnelService_StartAlreadyRunning(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-tunnel", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "dyn", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}
	created, err := svc.Create(model.TunnelInputFrom(tunnel))
	require.NoError(t, err)

	err = svc.Start(created.ID)
	require.NoError(t, err)
	t.Cleanup(func() { _ = svc.Stop(created.ID) })

	err = svc.Start(created.ID)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already running")
}

func TestTunnelService_ConcurrentStartReservesSingleRuntime(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	createdSession, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "test-concurrent", Host: "127.0.0.1", Port: parsePort(t, addr), Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	service := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())
	created, err := service.Create(model.TunnelInputFrom(model.Tunnel{
		SessionID: createdSession.ID, Name: "concurrent", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}))
	require.NoError(t, err)

	start := make(chan struct{})
	results := make(chan error, 2)
	for range 2 {
		go func() { <-start; results <- service.Start(created.ID) }()
	}
	close(start)
	first, second := <-results, <-results

	assert.Equal(t, 1, boolToInt(first == nil)+boolToInt(second == nil))
	assert.Equal(t, 1, sessionSvc.ConnectionCount())
	require.NoError(t, service.Stop(created.ID))
	assert.Equal(t, 0, sessionSvc.ConnectionCount())
}

func TestTunnelService_StopNotRunning(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err := svc.Stop(999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestTunnelService_DeleteRunning(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-tunnel", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	svc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "del", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 0,
	}
	created, err := svc.Create(model.TunnelInputFrom(tunnel))
	require.NoError(t, err)

	err = svc.Start(created.ID)
	require.NoError(t, err)

	err = svc.Delete(created.ID)
	require.NoError(t, err)
	assert.Equal(t, 0, sessionSvc.ConnectionCount())

	list, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, list, 0)
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func TestTunnelService_Remote(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	sess := model.Session{
		Name: "test", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "remote", Type: model.TunnelRemote,
		LocalHost: "127.0.0.1", LocalPort: 9000, RemoteHost: "remote", RemotePort: 9000,
	}
	created, err := svc.Create(model.TunnelInputFrom(tunnel))
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
}

func TestTunnelService_LocalForward(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	sess := model.Session{
		Name: "test", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "local", Type: model.TunnelLocal,
		LocalHost: "127.0.0.1", LocalPort: 5000, RemoteHost: "remote", RemotePort: 5000,
	}
	created, err := svc.Create(model.TunnelInputFrom(tunnel))
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
}

func TestTunnelService_StartConnectError(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	sess := model.Session{
		Name: "dead-sess", Host: "127.0.0.1", Port: 19, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "dead-tunnel", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 15003,
	}
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())
	created, err := svc.Create(model.TunnelInputFrom(tunnel))
	require.NoError(t, err)

	err = svc.Start(created.ID)
	assert.Error(t, err)
}

func TestTunnelServiceRejectsNonLoopbackLocalBind(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewTunnelService(db, NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger()), newMockEventBus(), testutil.NewTestLogger())
	_, err := svc.Create(model.TunnelInputFrom(model.Tunnel{
		Name: "dyn", SessionID: 1, Type: model.TunnelDynamic,
		LocalHost: "0.0.0.0", LocalPort: 1080,
	}))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "loopback")
}

func TestValidateTunnelBindCoreFields(t *testing.T) {
	base := model.Tunnel{
		SessionID: 1, Name: "web", Type: model.TunnelLocal,
		LocalHost: "127.0.0.1", LocalPort: 8080, RemoteHost: "10.0.0.2", RemotePort: 80,
	}
	require.NoError(t, validateTunnelBind(base))

	tests := []struct {
		name   string
		mutate func(*model.Tunnel)
	}{
		{name: "missing session", mutate: func(tunnel *model.Tunnel) { tunnel.SessionID = 0 }},
		{name: "empty name", mutate: func(tunnel *model.Tunnel) { tunnel.Name = "  " }},
		{name: "bad type", mutate: func(tunnel *model.Tunnel) { tunnel.Type = "magic" }},
		{name: "remote port zero", mutate: func(tunnel *model.Tunnel) { tunnel.RemotePort = 0 }},
		{name: "missing remote host", mutate: func(tunnel *model.Tunnel) { tunnel.RemoteHost = "" }},
		{name: "local host nul", mutate: func(tunnel *model.Tunnel) { tunnel.LocalHost = string([]byte{'a', 0}) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tunnel := base
			test.mutate(&tunnel)
			require.Error(t, validateTunnelBind(tunnel))
		})
	}

	dynamic := model.Tunnel{SessionID: 1, Name: "socks", Type: model.TunnelDynamic, LocalHost: "127.0.0.1", LocalPort: 1080}
	require.NoError(t, validateTunnelBind(dynamic))
}
