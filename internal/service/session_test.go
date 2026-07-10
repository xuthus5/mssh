package service

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
	"mssh/internal/service/testutil"
	sshtestutil "mssh/internal/ssh/testutil"
	"mssh/internal/store"
	"mssh/pkg/event"
)

type mockEventBus struct {
	mu     sync.Mutex
	events []CapturedEvent
}

type CapturedEvent struct {
	Name    string
	Payload interface{}
}

func newMockEventBus() *mockEventBus {
	return &mockEventBus{}
}

func (m *mockEventBus) Emit(name string, payload interface{}) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, CapturedEvent{Name: name, Payload: payload})
}

func (m *mockEventBus) Events() []CapturedEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]CapturedEvent, len(m.events))
	copy(result, m.events)
	return result
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
	svc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	folders, err := svc.ListFolders()
	require.NoError(t, err)
	assert.Len(t, folders, 0)

	var parentID int64 = 0
	folder, err := svc.CreateFolder("生产环境", &parentID)
	require.NoError(t, err)
	assert.Equal(t, "生产环境", folder.Name)

	folders, err = svc.ListFolders()
	require.NoError(t, err)
	assert.Len(t, folders, 1)

	err = svc.UpdateFolder(folder.ID, "开发环境")
	require.NoError(t, err)
	folders, err = svc.ListFolders()
	require.NoError(t, err)
	assert.Equal(t, "开发环境", folders[0].Name)

	var newParent int64 = 1
	err = svc.MoveFolder(folder.ID, &newParent)
	require.NoError(t, err)

	err = svc.DeleteFolder(folder.ID)
	require.NoError(t, err)
	folders, err = svc.ListFolders()
	require.NoError(t, err)
	assert.Len(t, folders, 0)
}

func TestSessionService_SessionCRUD(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	sessions, err := svc.ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, sessions, 0)

	sess := model.Session{
		Name: "web-server", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "encrypted", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := svc.CreateSession(sess)
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
	err = svc.UpdateSession(*created)
	require.NoError(t, err)

	fetched, err = svc.GetSession(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "db-server", fetched.Name)

	var newFolderID int64 = 2
	err = svc.MoveSession(created.ID, &newFolderID)
	require.NoError(t, err)

	err = svc.DeleteSession(created.ID)
	require.NoError(t, err)
	sessions, err = svc.ListSessions(nil)
	require.NoError(t, err)
	assert.Len(t, sessions, 0)
}

func TestSessionService_ConnectDisconnect(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := svc.CreateSession(sess)
	require.NoError(t, err)

	ctx := context.Background()
	terminalID, err := svc.Connect(ctx, created.ID)
	require.NoError(t, err)
	assert.NotEmpty(t, terminalID)
	assert.Contains(t, terminalID, "term-")

	assert.Equal(t, 1, svc.ConnectionCount())

	lastEvent := bus.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.ConnectionState, lastEvent.Name)
	payload, ok := lastEvent.Payload.(event.ConnectionStatePayload)
	require.True(t, ok)
	assert.Equal(t, terminalID, payload.TerminalID)
	assert.Equal(t, "connected", payload.State)

	err = svc.Disconnect(terminalID)
	require.NoError(t, err)
	assert.Equal(t, 0, svc.ConnectionCount())

	allEvents := bus.Events()
	assert.Len(t, allEvents, 2)
	discPayload, ok := allEvents[1].Payload.(event.ConnectionStatePayload)
	require.True(t, ok)
	assert.Equal(t, "disconnected", discPayload.State)
}

func TestSessionService_ConnectSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	ctx := context.Background()
	_, err := svc.Connect(ctx, 999)
	assert.Error(t, err)
}

func TestSessionService_DisconnectUnknown(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	err := svc.Disconnect("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestSessionService_NewSessionService(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 60, "", nil, testutil.NewTestLogger())
	assert.Equal(t, 60, svc.keepAlive)
	assert.NotNil(t, svc.conns)
	assert.Equal(t, 0, len(svc.conns))
}

func TestSessionService_buildAuthMethodsPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthPassword, Password: "secret"}
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.Len(t, methods, 1)
}

func TestSessionService_buildAuthMethodsKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthKey, KeyID: ptr(int64(999))}
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.Len(t, methods, 0)

	keyPEM := generateTestPrivateKey(t)
	testKey := model.SSHKey{Name: "test", Type: model.KeyTypeED25519, PrivateKey: keyPEM}
	createdKey, err := store.CreateKey(db, testKey)
	require.NoError(t, err)

	sess.KeyID = &createdKey.ID
	methods, err = svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.Len(t, methods, 1)
}

func TestSessionService_buildAuthMethodsKeyboardInteractive(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthKeyboardInteractive, Password: "secret"}
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.Len(t, methods, 1)
}

func TestSessionService_buildAuthMethodsUnknown(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: "unknown"}
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.Len(t, methods, 0)
}

func TestSessionService_buildAuthMethodsKeyInvalidKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	testKey := model.SSHKey{Name: "bad-key", Type: model.KeyTypeED25519, PrivateKey: "not-a-valid-private-key"}
	createdKey, err := store.CreateKey(db, testKey)
	require.NoError(t, err)

	sess := &model.Session{AuthMethod: model.AuthKey, KeyID: &createdKey.ID}
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.Len(t, methods, 0)
}

func TestSessionService_buildAuthMethodsAgent(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthAgent}
	methods, err := svc.buildAuthMethods(sess)
	assert.Nil(t, methods)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "SSH_AUTH_SOCK")
}

func TestSessionService_GetSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	_, err := svc.GetSession(999)
	assert.Error(t, err)
}

func parsePort(t *testing.T, addr string) int {
	t.Helper()
	var port int
	_, _ = fmt.Sscanf(addr, "127.0.0.1:%d", &port)
	return port
}

func ptr[T any](v T) *T {
	return &v
}

func generateTestPrivateKey(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	b, err := x509.MarshalPKCS8PrivateKey(priv)
	require.NoError(t, err)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}))
}
