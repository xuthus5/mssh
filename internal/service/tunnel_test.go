package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
	"mssh/internal/service/testutil"
	sshtestutil "mssh/internal/ssh/testutil"
	"mssh/pkg/event"
)

func TestNewTunnelService(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", testutil.NewTestLogger())
	bus := newMockEventBus()
	svc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())
	assert.NotNil(t, svc)
	assert.NotNil(t, svc.tunnels)
	assert.Equal(t, 0, len(svc.tunnels))
}

func TestTunnelService_List(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	tunnels, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, tunnels, 0)
}

func TestTunnelService_CRUD(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	sess := model.Session{
		Name: "test", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "web", Type: model.TunnelLocal,
		LocalHost: "127.0.0.1", LocalPort: 8080, RemoteHost: "remote", RemotePort: 80,
	}
	created, err := svc.Create(tunnel)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "web", created.Name)

	list, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, list, 1)

	created.Name = "api"
	err = svc.Update(*created)
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
	sessionSvc := NewSessionService(db, bus, 30, "", testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-tunnel", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "socks", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 15000,
	}
	created, err := svc.Create(tunnel)
	require.NoError(t, err)

	err = svc.Start(created.ID)
	require.NoError(t, err)

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
}

func TestTunnelService_StartNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err := svc.Start(999)
	assert.Error(t, err)
}

func TestTunnelService_StartAlreadyRunning(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-tunnel", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "dyn", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 15001,
	}
	created, err := svc.Create(tunnel)
	require.NoError(t, err)

	err = svc.Start(created.ID)
	require.NoError(t, err)

	err = svc.Start(created.ID)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already running")
}

func TestTunnelService_StopNotRunning(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err := svc.Stop(999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not running")
}

func TestTunnelService_DeleteRunning(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-tunnel", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "del", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 15002,
	}
	created, err := svc.Create(tunnel)
	require.NoError(t, err)

	err = svc.Start(created.ID)
	require.NoError(t, err)

	err = svc.Delete(created.ID)
	require.NoError(t, err)

	list, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, list, 0)
}

func TestTunnelService_Remote(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", testutil.NewTestLogger())

	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	sess := model.Session{
		Name: "test", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "remote", Type: model.TunnelRemote,
		LocalHost: "127.0.0.1", LocalPort: 9000, RemoteHost: "remote", RemotePort: 9000,
	}
	created, err := svc.Create(tunnel)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
}

func TestTunnelService_LocalForward(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", testutil.NewTestLogger())

	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	sess := model.Session{
		Name: "test", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "local", Type: model.TunnelLocal,
		LocalHost: "127.0.0.1", LocalPort: 5000, RemoteHost: "remote", RemotePort: 5000,
	}
	created, err := svc.Create(tunnel)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
}

func TestTunnelService_StartConnectError(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", testutil.NewTestLogger())

	sess := model.Session{
		Name: "dead-sess", Host: "127.0.0.1", Port: 19, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	tunnel := model.Tunnel{
		SessionID: createdSess.ID, Name: "dead-tunnel", Type: model.TunnelDynamic,
		LocalHost: "127.0.0.1", LocalPort: 15003,
	}
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())
	created, err := svc.Create(tunnel)
	require.NoError(t, err)

	err = svc.Start(created.ID)
	assert.Error(t, err)
}
