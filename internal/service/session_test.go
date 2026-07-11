package service

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

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
	svc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

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
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
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
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	require.NoError(t, db.Close())
	assert.Error(t, svc.SetDefaultFolder(1))
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
	assert.Len(t, allEvents, 3)
	discPayload, ok := allEvents[2].Payload.(event.ConnectionStatePayload)
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
	assert.Len(t, methods, 2) // password + keyboard-interactive fallback
}

func TestSessionService_buildAuthMethodsKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthKey, KeyID: ptr(int64(999))}
	_, err := svc.buildAuthMethods(sess)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "load key")

	keyPEM := generateTestPrivateKey(t)
	testKey := model.SSHKey{Name: "test", Type: model.KeyTypeED25519, PrivateKey: keyPEM}
	createdKey, err := store.CreateKey(db, testKey)
	require.NoError(t, err)

	sess.KeyID = &createdKey.ID
	methods, err := svc.buildAuthMethods(sess)
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
	_, err = svc.buildAuthMethods(sess)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse private key")
}

func TestSessionService_buildAuthMethodsKeyNilID(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthKey}
	_, err := svc.buildAuthMethods(sess)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "requires key_id")
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

func TestSessionService_buildKeyboardInteractiveAuthEmpty(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthKeyboardInteractive, Password: ""}
	methods := svc.buildKeyboardInteractiveAuth(sess)
	assert.Len(t, methods, 1)
}

func TestSessionService_decryptPrivateKeyWithCrypto(t *testing.T) {
	db := testutil.NewTestDB(t)
	enc := &noopCrypto{}
	svc := NewSessionService(db, newMockEventBus(), 30, "", enc, testutil.NewTestLogger())

	keyPEM := generateTestPrivateKey(t)
	encrypted, err := enc.Encrypt([]byte(keyPEM))
	require.NoError(t, err)

	decrypted, err := svc.decryptPrivateKey(string(encrypted))
	require.NoError(t, err)
	assert.Equal(t, keyPEM, string(decrypted))
}

func TestSessionService_decryptPrivateKeyFail(t *testing.T) {
	db := testutil.NewTestDB(t)
	enc := &errCrypto{}
	svc := NewSessionService(db, newMockEventBus(), 30, "", enc, testutil.NewTestLogger())

	_, err := svc.decryptPrivateKey("invalid-encrypted-data")
	assert.Error(t, err)
}

func TestSessionService_buildKeyboardInteractiveCallback(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthKeyboardInteractive, Password: "secret"}
	methods := svc.buildKeyboardInteractiveAuth(sess)
	require.Len(t, methods, 1)

	// Invoke the keyboard-interactive callback to cover the closure body
	ki, ok := methods[0].(gossh.KeyboardInteractiveChallenge)
	require.True(t, ok)
	answers, err := ki("user", "instruction", []string{"q1", "q2"}, []bool{false, false})
	require.NoError(t, err)
	assert.Equal(t, []string{"secret", "secret"}, answers)
}

// startTestSSHAgent 启动一个 ssh-agent 并加载测试密钥，返回其 socket 路径。
// 测试结束后会自动清理 agent 进程。
func startTestSSHAgent(t *testing.T) (string, func()) {
	t.Helper()
	// 生成测试密钥
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "id_ed25519")
	cmd := exec.Command("ssh-keygen", "-t", "ed25519", "-f", keyPath, "-N", "", "-q")
	require.NoError(t, cmd.Run(), "ssh-keygen failed")

	// 启动 ssh-agent，获取其 socket 路径与 PID
	agentCmd := exec.Command("ssh-agent", "-s")
	output, err := agentCmd.Output()
	require.NoError(t, err, "ssh-agent start failed")

	var socketPath string
	var agentPID string
	for _, line := range strings.Split(string(output), ";") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "SSH_AUTH_SOCK=") {
			socketPath = strings.TrimPrefix(line, "SSH_AUTH_SOCK=")
		}
		if strings.HasPrefix(line, "SSH_AGENT_PID=") {
			agentPID = strings.TrimPrefix(line, "SSH_AGENT_PID=")
		}
	}
	require.NotEmpty(t, socketPath, "failed to parse SSH_AUTH_SOCK")

	cleanup := func() {
		if agentPID != "" {
			_ = exec.Command("kill", agentPID).Run()
		}
		_ = os.Remove(socketPath)
	}

	// 将密钥加载到 agent
	t.Setenv("SSH_AUTH_SOCK", socketPath)
	t.Setenv("SSH_ASKPASS", "")
	loadCmd := exec.Command("ssh-add", keyPath)
	loadCmd.Env = append(os.Environ(), "SSH_AUTH_SOCK="+socketPath)
	require.NoError(t, loadCmd.Run(), "ssh-add failed")

	return socketPath, cleanup
}

func TestSessionService_buildAgentAuthSuccess(t *testing.T) {
	socketPath, cleanup := startTestSSHAgent(t)
	defer cleanup()

	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	t.Setenv("SSH_AUTH_SOCK", socketPath)
	methods, err := svc.buildAgentAuth()
	require.NoError(t, err)
	assert.Len(t, methods, 1)
}

func TestSessionService_buildAgentAuthInvalidSocket(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	// 指向不存在的 socket 文件，触发 net.Dial 失败
	t.Setenv("SSH_AUTH_SOCK", filepath.Join(t.TempDir(), "nonexistent.sock"))
	_, err := svc.buildAgentAuth()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ssh agent")
}

func TestSessionService_buildAuthMethodsAgentSuccess(t *testing.T) {
	socketPath, cleanup := startTestSSHAgent(t)
	defer cleanup()

	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthAgent}
	t.Setenv("SSH_AUTH_SOCK", socketPath)
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.NotEmpty(t, methods)
}

func TestSessionServiceHostKeyDecisionAccept(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	svc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	attemptID := svc.registerConnectAttempt(cancel)
	defer svc.finishConnectAttempt(attemptID)

	result := make(chan bool, 1)
	go func() {
		result <- svc.awaitHostKeyDecision(ctx, attemptID, "example.com", "ssh-ed25519", "SHA256:test")
	}()

	require.Eventually(t, func() bool {
		return bus.hasEvent(event.HostKeyFingerprint)
	}, time.Second, 10*time.Millisecond)
	require.NoError(t, svc.DecideHostKey(attemptID, true))
	assert.True(t, <-result)
}

func TestSessionServiceHostKeyDecisionReject(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	attemptID := svc.registerConnectAttempt(cancel)
	defer svc.finishConnectAttempt(attemptID)

	result := make(chan bool, 1)
	go func() {
		result <- svc.awaitHostKeyDecision(ctx, attemptID, "example.com", "ssh-ed25519", "SHA256:test")
	}()

	require.NoError(t, svc.DecideHostKey(attemptID, false))
	assert.False(t, <-result)
}

func TestSessionServiceCancelConnect(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	cancelled := make(chan struct{})
	attemptID := svc.registerConnectAttempt(func() { close(cancelled) })
	require.NoError(t, svc.CancelConnect(attemptID))
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("connection attempt was not cancelled")
	}
	assert.Error(t, svc.CancelConnect(attemptID))
}

func TestSessionServiceHostKeyDecisionUnknownAttempt(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	assert.Error(t, svc.DecideHostKey("missing", true))
	assert.Error(t, svc.CancelConnect("missing"))
}
