package service

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"strings"
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

func TestPlanProxyPasswordSettingEdgeCases(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	runtime.SetDEK(bytes.Repeat([]byte{7}, 32))

	got, err := planProxyPasswordSetting(db, runtime, runtime)
	require.NoError(t, err)
	assert.Nil(t, got)

	// Empty JSON string → nil.
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: `""`, ValueType: "string", Version: 1,
	}}))
	got, err = planProxyPasswordSetting(db, runtime, runtime)
	require.NoError(t, err)
	assert.Nil(t, got)

	// Bypass store validation to seed invalid JSON payload.
	_, err = db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT(key) DO UPDATE SET value=excluded.value, value_type=excluded.value_type, version=excluded.version, updated_at=datetime('now')`,
		applicationProxyPasswordSetting, "application", "{bad", "string", 1)
	require.NoError(t, err)
	_, err = planProxyPasswordSetting(db, runtime, runtime)
	require.Error(t, err)

	sealed, err := encryptProxyPasswordValue(runtime, "secret")
	require.NoError(t, err)
	payload, err := json.Marshal(sealed)
	require.NoError(t, err)
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: string(payload), ValueType: "string", Version: 1,
	}}))
	got, err = planProxyPasswordSetting(db, runtime, runtime)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, applicationProxyPasswordSetting, got.Key)
}

func TestPlanSyncCredentialSettingEdgeCases(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	runtime.SetDEK(bytes.Repeat([]byte{9}, 32))

	got, err := planSyncCredentialSetting(db, syncGistTokenSetting, runtime, runtime)
	require.NoError(t, err)
	assert.Nil(t, got)

	require.NoError(t, writeSyncSetting(db, syncGistTokenSetting, ""))
	got, err = planSyncCredentialSetting(db, syncGistTokenSetting, runtime, runtime)
	require.NoError(t, err)
	assert.Nil(t, got)

	require.NoError(t, writeSyncSetting(db, syncGistTokenSetting, "not-encrypted"))
	_, err = planSyncCredentialSetting(db, syncGistTokenSetting, runtime, runtime)
	require.Error(t, err)

	require.NoError(t, writeSyncSetting(db, syncGistTokenSetting, string(mustEncrypt(t, runtime, "tok"))))
	got, err = planSyncCredentialSetting(db, syncGistTokenSetting, runtime, runtime)
	require.NoError(t, err)
	require.NotNil(t, got)
}

func TestEncryptDecryptProxyPasswordValueEdges(t *testing.T) {
	_, err := encryptProxyPasswordValue(nil, "x")
	require.Error(t, err)
	_, err = decryptProxyPasswordValue(nil, proxyPasswordEncPrefix+"x")
	require.Error(t, err)

	plain, err := decryptProxyPasswordValue(nil, "legacy-plain")
	require.NoError(t, err)
	assert.Equal(t, "legacy-plain", plain)
	plain, err = decryptProxyPasswordValue(nil, "  ")
	require.NoError(t, err)
	assert.Equal(t, "", plain)

	runtime := NewCryptoRuntime()
	runtime.SetDEK(bytes.Repeat([]byte{1}, 32))
	sealed, err := encryptProxyPasswordValue(runtime, "s3cr3t")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(sealed, proxyPasswordEncPrefix))
	opened, err := decryptProxyPasswordValue(runtime, sealed)
	require.NoError(t, err)
	assert.Equal(t, "s3cr3t", opened)
}

func TestApplyKeyPrivateKeyUpdateNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	tx, err := db.Begin()
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback() })
	err = applyKeyPrivateKeyUpdate(tx, reencryptKeyUpdate{id: 99999, privateKey: "x"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestApplySessionPasswordUpdateNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	tx, err := db.Begin()
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback() })
	err = applySessionPasswordUpdate(tx, reencryptSessionUpdate{id: 99999, password: "x"})
	require.Error(t, err)
}
