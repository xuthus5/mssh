package service

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

type mockEventBus struct {
	mu                sync.Mutex
	events            []CapturedEvent
	autoAcceptHostKey bool
}

type CapturedEvent struct {
	Name    string
	Payload interface{}
}

func newMockEventBus() *mockEventBus {
	return &mockEventBus{autoAcceptHostKey: true}
}

func newManualHostKeyEventBus() *mockEventBus {
	return &mockEventBus{autoAcceptHostKey: false}
}

func (m *mockEventBus) Emit(name string, payload interface{}) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, CapturedEvent{Name: name, Payload: payload})
}

func (m *mockEventBus) AutoAcceptHostKeys() bool { return m.autoAcceptHostKey }

func (m *mockEventBus) Events() []CapturedEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]CapturedEvent, len(m.events))
	copy(result, m.events)
	return result
}

func (m *mockEventBus) hasEvent(name string) bool {
	for _, captured := range m.Events() {
		if captured.Name == name {
			return true
		}
	}
	return false
}

func (m *mockEventBus) LastEvent() *CapturedEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.events) == 0 {
		return nil
	}
	last := m.events[len(m.events)-1]
	return &last
}

func TestSessionService_FolderCRUD(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	folders, err := svc.ListFolders()
	require.NoError(t, err)
	require.Len(t, folders, 1)
	assert.True(t, folders[0].IsDefault)

	folder, err := svc.CreateFolder("生产环境", nil)
	require.NoError(t, err)
	assert.Equal(t, "生产环境", folder.Name)

	folders, err = svc.ListFolders()
	require.NoError(t, err)
	assert.Len(t, folders, 2)

	err = svc.UpdateFolder(folder.ID, "开发环境")
	require.NoError(t, err)
	folders, err = svc.ListFolders()
	require.NoError(t, err)
	assert.Equal(t, "开发环境", folders[1].Name)

	var newParent int64 = 1
	err = svc.MoveFolder(folder.ID, &newParent)
	require.NoError(t, err)

	err = svc.DeleteFolder(folder.ID)
	require.NoError(t, err)
	folders, err = svc.ListFolders()
	require.NoError(t, err)
	assert.Len(t, folders, 1)
}

func TestSessionService_SetDefaultFolder(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	folder, err := svc.CreateFolder("生产环境", nil)
	require.NoError(t, err)
	require.NoError(t, svc.SetDefaultFolder(folder.ID))
	folders, err := svc.ListFolders()
	require.NoError(t, err)
	for _, item := range folders {
		assert.Equal(t, item.ID == folder.ID, item.IsDefault)
	}
}

func TestSessionService_SetDefaultFolderError(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	require.NoError(t, db.Close())
	assert.Error(t, svc.SetDefaultFolder(1))
}

func TestSessionService_SessionCRUD(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	sessions, err := svc.ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, sessions, 0)

	sess := model.Session{
		Name: "web-server", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "encrypted", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := svc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)
	assert.NotZero(t, created.ID)

	sessions, err = svc.ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, sessions, 1)
	assert.Equal(t, "web-server", sessions[0].Name)

	fetched, err := svc.GetSession(created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, fetched.ID)

	created.Name = "db-server"
	err = svc.UpdateSession(model.SessionInputFrom(*created))
	require.NoError(t, err)

	fetched, err = svc.GetSession(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "db-server", fetched.Name)

	folder, err := svc.CreateFolder("目标分组", nil)
	require.NoError(t, err)
	newFolderID := folder.ID
	err = svc.MoveSession(created.ID, &newFolderID)
	require.NoError(t, err)

	err = svc.DeleteSession(created.ID)
	require.NoError(t, err)
	sessions, err = svc.ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, sessions, 0)
}

func TestSessionService_InternalConnectDisconnect(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := svc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	ctx := context.Background()
	terminalID, err := svc.connect(ctx, created.ID, true)
	require.NoError(t, err)
	assert.NotEmpty(t, terminalID)
	assert.Contains(t, terminalID, "term-")

	assert.Equal(t, 1, svc.ConnectionCount())
	recent, err := svc.ListRecentSessions(10)
	require.NoError(t, err)
	require.Len(t, recent, 1)
	assert.Equal(t, created.ID, recent[0].ID)
	assert.Equal(t, 1, recent[0].ConnectionCount)

	lastEvent := bus.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.ConnectionState, lastEvent.Name)
	payload, ok := lastEvent.Payload.(event.ConnectionStatePayload)
	require.True(t, ok)
	assert.Equal(t, terminalID, payload.TerminalID)
	assert.Equal(t, "connected", payload.State)

	err = svc.disconnect(terminalID, true)
	require.NoError(t, err)
	assert.Equal(t, 0, svc.ConnectionCount())

	allEvents := bus.Events()
	// attempt + host-key fingerprint + connected + disconnected
	require.GreaterOrEqual(t, len(allEvents), 4)
	var states []string
	for _, captured := range allEvents {
		if captured.Name != event.ConnectionState {
			continue
		}
		payload, ok := captured.Payload.(event.ConnectionStatePayload)
		require.True(t, ok)
		states = append(states, payload.State)
	}
	assert.Equal(t, []string{"connected", "disconnected"}, states)
}

func TestSessionService_InternalConnectSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	ctx := context.Background()
	_, err := svc.connect(ctx, 999, true)
	assert.Error(t, err)
}

func TestSessionService_InternalDisconnectUnknown(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	err := svc.disconnect("nonexistent", true)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestSessionService_NewSessionService(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 60, t.TempDir(), nil, testutil.NewTestLogger())
	assert.Equal(t, 60, svc.keepAlive)
	assert.NotNil(t, svc.conns)
	assert.Equal(t, 0, len(svc.conns))
}

func TestSessionService_ResolveKeepAlive(t *testing.T) {
	tests := []struct {
		name             string
		sessionKeepAlive int
		defaultKeepAlive int
		persistedDefault *model.Setting
		want             int
	}{
		{
			name:             "session override wins",
			sessionKeepAlive: 15,
			defaultKeepAlive: 30,
			persistedDefault: &model.Setting{Key: "terminal.default_keep_alive", Namespace: "terminal", Value: "90", ValueType: "number", Version: 1},
			want:             15,
		},
		{
			name:             "zero follows persisted default",
			sessionKeepAlive: 0,
			defaultKeepAlive: 30,
			persistedDefault: &model.Setting{Key: "terminal.default_keep_alive", Namespace: "terminal", Value: "90", ValueType: "number", Version: 1},
			want:             90,
		},
		{
			name:             "missing setting uses service default",
			sessionKeepAlive: 0,
			defaultKeepAlive: 45,
			want:             45,
		},
		{
			name:             "invalid setting uses service default",
			sessionKeepAlive: 0,
			defaultKeepAlive: 45,
			persistedDefault: &model.Setting{Key: "terminal.default_keep_alive", Namespace: "terminal", Value: `"invalid"`, ValueType: "string", Version: 1},
			want:             45,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			if test.persistedDefault != nil {
				require.NoError(t, NewSettingService(db, testutil.NewTestLogger()).Set(model.SettingInputFrom(*test.persistedDefault)))
			}
			svc := NewSessionService(db, newMockEventBus(), test.defaultKeepAlive, "", nil, testutil.NewTestLogger())
			session := model.Session{KeepAlive: test.sessionKeepAlive}

			require.NoError(t, svc.resolveKeepAlive(&session))
			assert.Equal(t, test.want, session.KeepAlive)
		})
	}
}

func TestSessionService_ResolveKeepAliveDatabaseError(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	require.NoError(t, db.Close())

	err := svc.resolveKeepAlive(&model.Session{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "load default keep-alive")
}

func TestSessionService_NewSessionServiceNormalizesKeepAlive(t *testing.T) {
	svc := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 0, t.TempDir(), nil, testutil.NewTestLogger())

	assert.Equal(t, DefaultKeepAliveSeconds, svc.keepAlive)
}
