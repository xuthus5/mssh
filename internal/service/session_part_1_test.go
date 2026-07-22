package service

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionService_buildAuthMethodsPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthPassword, Password: "secret"}
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.Len(t, methods, 2) // password + keyboard-interactive fallback
}

func TestSessionService_buildAuthMethodsKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

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
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthKeyboardInteractive, Password: "secret"}
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.Len(t, methods, 1)
}

func TestSessionService_buildAuthMethodsUnknown(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: "unknown"}
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.Len(t, methods, 0)
}

func TestSessionService_buildAuthMethodsKeyInvalidKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

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
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthKey}
	_, err := svc.buildAuthMethods(sess)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "requires key_id")
}

func TestSessionService_buildAuthMethodsAgent(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthAgent}
	methods, err := svc.buildAuthMethods(sess)
	assert.Nil(t, methods)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "SSH_AUTH_SOCK")
}

func TestSessionService_GetSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

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
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthKeyboardInteractive, Password: ""}
	methods := svc.buildKeyboardInteractiveAuth(sess)
	assert.Len(t, methods, 1)
}

func TestSessionService_decryptPrivateKeyWithCrypto(t *testing.T) {
	db := testutil.NewTestDB(t)
	enc := &noopCrypto{}
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), enc, testutil.NewTestLogger())

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
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), enc, testutil.NewTestLogger())

	_, err := svc.decryptPrivateKey("invalid-encrypted-data")
	assert.Error(t, err)
}

func TestSessionService_buildKeyboardInteractiveCallback(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

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
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	t.Setenv("SSH_AUTH_SOCK", socketPath)
	methods, err := svc.buildAgentAuth()
	require.NoError(t, err)
	assert.Len(t, methods, 1)
}

func TestSessionService_buildAgentAuthInvalidSocket(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

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
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	sess := &model.Session{AuthMethod: model.AuthAgent}
	t.Setenv("SSH_AUTH_SOCK", socketPath)
	methods, err := svc.buildAuthMethods(sess)
	require.NoError(t, err)
	assert.NotEmpty(t, methods)
}

func TestAgentAuthCloseNilSafe(t *testing.T) {
	var auth *agentAuth
	auth.Close()
	auth = &agentAuth{}
	auth.Close()
}
