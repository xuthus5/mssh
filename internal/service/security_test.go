package service

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type memoryKeychain struct {
	data map[string][]byte
}

func (m *memoryKeychain) Get(_, account string) ([]byte, error) {
	if m.data == nil {
		return nil, nil
	}
	return m.data[account], nil
}

func (m *memoryKeychain) Set(_, account string, data []byte) error {
	if m.data == nil {
		m.data = map[string][]byte{}
	}
	m.data[account] = append([]byte(nil), data...)
	return nil
}

func (m *memoryKeychain) Delete(_, account string) error {
	delete(m.data, account)
	return nil
}

func (m *memoryKeychain) IsAvailable() bool { return true }

func TestSecurityService_SetupUnlockRotate(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	svc := NewSecurityService(db, dir, runtime, keychain, nil)

	status, err := svc.Status()
	require.NoError(t, err)
	assert.False(t, status.Configured)
	assert.False(t, status.Unlocked)

	status, err = svc.Setup(model.SecuritySetupInput{
		Password: "initial-pass-12", RememberUnlock: true,
	})
	require.NoError(t, err)
	assert.True(t, status.Configured)
	assert.True(t, status.Unlocked)
	require.True(t, crypto.VaultExists(dir))

	// create encrypted key material with current DEK
	keySvc := NewKeyService(db, runtime, testutil.NewTestLogger())
	material, err := keySvc.Generate("demo", model.KeyTypeED25519, 0)
	require.NoError(t, err)
	require.NotEmpty(t, material.PrivateKey)

	// create sealed session password
	sessionSvc := NewSessionService(db, nil, 30, dir, runtime, testutil.NewTestLogger())
	created, err := sessionSvc.CreateSession(model.SessionInput{
		Name: "n", Host: "1.1.1.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "s3cret-password", KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	assert.Empty(t, created.Password) // redacted

	raw, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	assert.NotEqual(t, "s3cret-password", raw.Password)
	assert.Contains(t, raw.Password, "enc1:")

	status, err = svc.Rotate(model.SecurityRotateInput{
		CurrentPassword: "initial-pass-12",
		NewPassword:     "rotated-pass-12",
	})
	require.NoError(t, err)
	assert.True(t, status.Unlocked)

	// old password fails
	_, err = svc.Unlock(model.SecurityUnlockInput{Password: "initial-pass-12"})
	require.Error(t, err)

	// new password unlocks and key still decrypts
	status, err = svc.Unlock(model.SecurityUnlockInput{Password: "rotated-pass-12", RememberUnlock: true})
	require.NoError(t, err)
	assert.True(t, status.Unlocked)
	got, err := keySvc.GetMaterial(material.ID)
	require.NoError(t, err)
	assert.Equal(t, material.PrivateKey, got.PrivateKey)

	// session password still usable for connect path
	forConnect, err := sessionSvc.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "s3cret-password", forConnect.Password)

	// remembered DEK present
	assert.Len(t, keychain.data[securityKeychainDEKAccount], 32)
	_ = filepath.Join(dir, crypto.VaultFileName)
}

func TestSecurityService_RequirePasswordOnLaunchSkipsAutoUnlock(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	svc := NewSecurityService(db, dir, runtime, keychain, nil)
	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true, RequirePasswordOnLaunch: true})
	require.NoError(t, err)
	runtime.Clear()

	require.NoError(t, svc.TryAutoUnlock())
	assert.False(t, runtime.Unlocked())
}

func TestSecurityService_RequireUnlocked(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	svc := NewSecurityService(db, dir, runtime, &memoryKeychain{}, nil)

	require.ErrorIs(t, svc.RequireUnlocked(), ErrVaultLocked)
	_, err := runtime.Encrypt([]byte("x"))
	require.ErrorIs(t, err, ErrVaultLocked)

	_, err = svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: false})
	require.NoError(t, err)
	require.NoError(t, svc.RequireUnlocked())

	_, err = svc.Lock()
	require.NoError(t, err)
	require.ErrorIs(t, svc.RequireUnlocked(), ErrVaultLocked)
}

func TestCryptoRuntime_RequireUnlocked(t *testing.T) {
	var runtime *CryptoRuntime
	require.ErrorIs(t, runtime.RequireUnlocked(), ErrVaultLocked)
	runtime = NewCryptoRuntime()
	require.ErrorIs(t, runtime.RequireUnlocked(), ErrVaultLocked)
	runtime.SetDEK(make([]byte, 32))
	require.NoError(t, runtime.RequireUnlocked())
	runtime.Clear()
	require.ErrorIs(t, runtime.RequireUnlocked(), ErrVaultLocked)
}

func TestSecurityService_CrossDeviceSyncSecretFromSharedVault(t *testing.T) {
	password := "shared-pass-123"
	dirA := t.TempDir()
	dirB := t.TempDir()
	dbA := testutil.NewTestDB(t)
	dbB := testutil.NewTestDB(t)
	runtimeA := NewCryptoRuntime()
	runtimeB := NewCryptoRuntime()
	secA := NewSecurityService(dbA, dirA, runtimeA, &memoryKeychain{}, nil)
	secB := NewSecurityService(dbB, dirB, runtimeB, &memoryKeychain{}, nil)

	_, err := secA.Setup(model.SecuritySetupInput{Password: password, RememberUnlock: true})
	require.NoError(t, err)
	vault, err := secA.ExportVaultFile()
	require.NoError(t, err)
	secretA, err := secA.SyncSecret()
	require.NoError(t, err)

	require.NoError(t, secB.InstallVaultFromExport(password, vault))
	secretB, err := secB.SyncSecret()
	require.NoError(t, err)
	assert.Equal(t, secretA, secretB)

	// encrypted private key from A decrypts on B after vault install (same DEK)
	keyA := NewKeyService(dbA, runtimeA, testutil.NewTestLogger())
	material, err := keyA.Generate("shared", model.KeyTypeED25519, 0)
	require.NoError(t, err)
	stored, err := store.GetKey(dbA, material.ID)
	require.NoError(t, err)
	// copy ciphertext to B's db
	_, err = store.CreateKey(dbB, model.SSHKey{Name: "shared", Type: model.KeyTypeED25519, PrivateKey: stored.PrivateKey, PublicKey: stored.PublicKey})
	require.NoError(t, err)
	keys, err := store.ListKeys(dbB)
	require.NoError(t, err)
	require.Len(t, keys, 1)
	got, err := NewKeyService(dbB, runtimeB, testutil.NewTestLogger()).GetMaterial(keys[0].ID)
	require.NoError(t, err)
	assert.Equal(t, material.PrivateKey, got.PrivateKey)
}

func TestSyncService_ImportWithPasswordInstallsVault(t *testing.T) {
	password := "import-pass-12"
	dirA := t.TempDir()
	dbA := testutil.NewTestDB(t)
	runtimeA := NewCryptoRuntime()
	secA := NewSecurityService(dbA, dirA, runtimeA, &memoryKeychain{}, nil)
	_, err := secA.Setup(model.SecuritySetupInput{Password: password, RememberUnlock: true})
	require.NoError(t, err)
	secret, err := secA.SyncSecret()
	require.NoError(t, err)
	vault, err := secA.ExportVaultFile()
	require.NoError(t, err)

	_, err = store.CreateSession(dbA, model.Session{Name: "prod", Host: "10.0.0.2", Port: 22, Username: "root", AuthMethod: model.AuthPassword, Password: "enc1:placeholder", KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)

	syncA := newTestSyncService(dbA, secret, WithVaultSource(func() (*crypto.VaultFile, error) { return &vault, nil }))
	path := filepath.Join(t.TempDir(), "device.msshbackup")
	require.NoError(t, syncA.Export(path))

	dirB := t.TempDir()
	dbB := testutil.NewTestDB(t)
	runtimeB := NewCryptoRuntime()
	secB := NewSecurityService(dbB, dirB, runtimeB, &memoryKeychain{}, nil)
	syncB := newTestSyncService(dbB, "unused-before-install",
		WithVaultInstaller(secB.InstallVaultFromExport),
		WithSyncSecretSource(secB.SyncSecret),
		WithSyncCrypto(runtimeB),
	)
	require.NoError(t, syncB.ImportWithPassword(path, password))
	status, err := secB.Status()
	require.NoError(t, err)
	assert.True(t, status.Configured)
	assert.True(t, status.Unlocked)
	secretB, err := secB.SyncSecret()
	require.NoError(t, err)
	assert.Equal(t, secret, secretB)
	sessions, err := store.ListSessions(dbB, nil)
	require.NoError(t, err)
	require.NotEmpty(t, sessions)
	assert.Equal(t, "prod", sessions[0].Name)
}

func TestSyncService_JoinWithPassword(t *testing.T) {
	password := "join-device-12"
	dirA := t.TempDir()
	dbA := testutil.NewTestDB(t)
	runtimeA := NewCryptoRuntime()
	secA := NewSecurityService(dbA, dirA, runtimeA, &memoryKeychain{}, nil)
	_, err := secA.Setup(model.SecuritySetupInput{Password: password, RememberUnlock: true})
	require.NoError(t, err)
	secret, err := secA.SyncSecret()
	require.NoError(t, err)
	vault, err := secA.ExportVaultFile()
	require.NoError(t, err)
	_, err = store.CreateSession(dbA, model.Session{Name: "edge", Host: "10.0.0.9", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)

	syncA := newTestSyncService(dbA, secret, WithVaultSource(func() (*crypto.VaultFile, error) { return &vault, nil }))
	data, err := syncA.snapshot()
	require.NoError(t, err)
	fp, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, secret, syncArtifactMetadata{SnapshotFingerprint: fp}, &vault)
	require.NoError(t, err)

	dirB := t.TempDir()
	dbB := testutil.NewTestDB(t)
	runtimeB := NewCryptoRuntime()
	secB := NewSecurityService(dbB, dirB, runtimeB, &memoryKeychain{}, nil)
	provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content, ETag: "etag-1"}}
	syncB := newTestSyncService(dbB, "before-join",
		WithVaultInstaller(secB.InstallVaultFromExport),
		WithSyncSecretSource(secB.SyncSecret),
		WithSyncCrypto(runtimeB),
		WithSyncProviderFactory(fakeSyncProviderFactory{provider}),
	)
	input := model.SyncConfigInput{
		Enabled: true, Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart,
		IntervalMinutes: 15, RetentionCount: 30, RetentionDays: 90,
		Gist: model.GistSyncConfigInput{GistID: "gist-1", Token: "token-1"},
	}
	result, err := syncB.JoinWithPassword(input, password)
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	status, err := secB.Status()
	require.NoError(t, err)
	assert.True(t, status.Configured)
	assert.True(t, status.Unlocked)
	secretB, err := secB.SyncSecret()
	require.NoError(t, err)
	assert.Equal(t, secret, secretB)
	sessions, err := store.ListSessions(dbB, nil)
	require.NoError(t, err)
	require.NotEmpty(t, sessions)
	assert.Equal(t, "edge", sessions[0].Name)
}

func TestSecurityService_EmitsVaultChangedOnSetupAndUnlock(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	svc := NewSecurityService(db, dir, runtime, &memoryKeychain{}, nil)
	bus := newMockEventBus()
	svc.SetEventBus(bus)

	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)
	require.True(t, bus.hasEvent(securityVaultChangedEvent))

	_, err = svc.Lock()
	require.NoError(t, err)
	require.True(t, bus.hasEvent(securityVaultLockedEvent))

	bus = newMockEventBus()
	svc.SetEventBus(bus)
	_, err = svc.Unlock(model.SecurityUnlockInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)
	require.True(t, bus.hasEvent(securityVaultChangedEvent))
}

func TestSecurityService_UnlockRateLimit(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	svc := NewSecurityService(db, dir, runtime, &memoryKeychain{}, nil)
	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: false})
	require.NoError(t, err)
	require.NoError(t, runtime.RequireUnlocked())
	_, err = svc.Lock()
	require.NoError(t, err)

	for i := 0; i < securityUnlockMaxFailures; i++ {
		_, err = svc.Unlock(model.SecurityUnlockInput{Password: "wrong-password"})
		require.Error(t, err)
		require.NotErrorIs(t, err, errUnlockRateLimited)
	}
	_, err = svc.Unlock(model.SecurityUnlockInput{Password: "initial-pass-12"})
	require.Error(t, err)
	require.ErrorIs(t, err, errUnlockRateLimited)

	svc.unlock.mu.Lock()
	svc.unlock.lockedUntil = svc.unlock.now().Add(-time.Second)
	svc.unlock.mu.Unlock()
	status, err := svc.Unlock(model.SecurityUnlockInput{Password: "initial-pass-12"})
	require.NoError(t, err)
	assert.True(t, status.Unlocked)
}

func TestSecurityService_SavePreferencesAndAutoUnlock(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	svc := NewSecurityService(db, dir, runtime, keychain, nil)
	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)

	status, err := svc.SavePreferences(model.SecurityPreferenceInput{RequirePasswordOnLaunch: false, RememberUnlock: true})
	require.NoError(t, err)
	assert.True(t, status.RememberUnlock)
	assert.False(t, status.RequirePasswordOnLaunch)

	status, err = svc.SavePreferences(model.SecurityPreferenceInput{RequirePasswordOnLaunch: true, RememberUnlock: true})
	require.NoError(t, err)
	assert.True(t, status.RequirePasswordOnLaunch)
	assert.Empty(t, keychain.data[securityKeychainDEKAccount])

	status, err = svc.SavePreferences(model.SecurityPreferenceInput{RequirePasswordOnLaunch: false, RememberUnlock: false})
	require.NoError(t, err)
	assert.False(t, status.RememberUnlock)

	// unlock with remember so auto unlock can restore DEK
	_, err = svc.Unlock(model.SecurityUnlockInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)
	runtime.Clear()
	require.NoError(t, svc.TryAutoUnlock())
	require.NoError(t, runtime.RequireUnlocked())
}
