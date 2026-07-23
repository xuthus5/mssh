package service

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestSecurityRotateReencryptsKeysAndPasswords(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	svc := NewSecurityService(db, dir, runtime, keychain, testutil.NewTestLogger())
	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: false})
	require.NoError(t, err)

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, dir, runtime, testutil.NewTestLogger())
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "rot", Host: "1.1.1.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "session-secret", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)

	keySvc := NewKeyService(db, runtime, testutil.NewTestLogger())
	material, err := keySvc.Generate("k1", model.KeyTypeED25519, 256)
	require.NoError(t, err)
	require.NotNil(t, material)
	assert.NotEmpty(t, material.PrivateKey)

	settingSvc := NewSettingService(db, testutil.NewTestLogger(), SettingServiceOptions{Crypto: runtime})
	require.NoError(t, settingSvc.Set(model.SettingInputFrom(model.Setting{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: `"proxy-secret"`, ValueType: "string", Version: 1,
	})))
	require.NoError(t, writeSyncSetting(db, syncGistTokenSetting, string(mustEncrypt(t, runtime, "gist-token"))))
	require.NoError(t, writeSyncSetting(db, syncWebDAVPasswordSetting, string(mustEncrypt(t, runtime, "webdav-pass"))))
	require.NoError(t, writeSyncSetting(db, syncS3SecretSetting, string(mustEncrypt(t, runtime, "s3-secret"))))

	status, err := svc.Rotate(model.SecurityRotateInput{CurrentPassword: "initial-pass-12", NewPassword: "rotated-pass-12"})
	require.NoError(t, err)
	assert.True(t, status.Unlocked)

	connectable, err := sessionSvc.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "session-secret", connectable.Password)

	stored, err := store.GetKey(db, material.ID)
	require.NoError(t, err)
	plain, err := runtime.Decrypt([]byte(stored.PrivateKey))
	require.NoError(t, err)
	assert.NotEmpty(t, plain)

	proxy, saved := settingSvc.loadProxyPassword()
	assert.True(t, saved)
	assert.Equal(t, "proxy-secret", proxy)

	assert.Equal(t, "gist-token", mustLoadSyncSecret(t, db, runtime, syncGistTokenSetting))
	assert.Equal(t, "webdav-pass", mustLoadSyncSecret(t, db, runtime, syncWebDAVPasswordSetting))
	assert.Equal(t, "s3-secret", mustLoadSyncSecret(t, db, runtime, syncS3SecretSetting))
}

func mustEncrypt(t *testing.T, crypto KeyCrypto, value string) []byte {
	t.Helper()
	sealed, err := crypto.Encrypt([]byte(value))
	require.NoError(t, err)
	return sealed
}

func mustLoadSyncSecret(t *testing.T, db *sql.DB, crypto KeyCrypto, key string) string {
	t.Helper()
	var encrypted string
	require.NoError(t, readSyncSetting(db, key, &encrypted))
	plain, err := crypto.Decrypt([]byte(encrypted))
	require.NoError(t, err)
	return string(plain)
}

func TestTunnelHandleAcceptLoopExitCleansActiveReservation(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())

	reservation := &TunnelState{}
	svc.mu.Lock()
	svc.tunnels[42] = reservation
	svc.mu.Unlock()
	svc.handleAcceptLoopExit(42, reservation, "")
	svc.mu.Lock()
	_, exists := svc.tunnels[42]
	svc.mu.Unlock()
	assert.False(t, exists)
	assert.True(t, bus.hasEvent(event.TunnelState))

	stale := &TunnelState{}
	current := &TunnelState{}
	svc.mu.Lock()
	svc.tunnels[7] = current
	svc.mu.Unlock()
	svc.handleAcceptLoopExit(7, stale, "")
	svc.mu.Lock()
	_, exists = svc.tunnels[7]
	svc.mu.Unlock()
	assert.True(t, exists)
}
