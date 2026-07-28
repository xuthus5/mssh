package service

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestRecoverPendingRotationRestoresOldVaultAfterNewVaultWasInstalled(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	svc := NewSecurityService(db, dir, NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	oldVault, _, err := crypto.CreateVault("old-password-12")
	require.NoError(t, err)
	nextVault, _, err := crypto.RotateVaultPassword("old-password-12", "next-password-12", oldVault, nil)
	require.NoError(t, err)
	require.NoError(t, crypto.SaveVaultFile(crypto.VaultPath(dir), oldVault))
	require.NoError(t, svc.writePendingRotation(securityRotationMarker{Version: securityRotationMarkerVersion, OldVault: oldVault, NewVault: nextVault}))
	require.NoError(t, crypto.SaveVaultFile(crypto.VaultPath(dir), nextVault))

	require.NoError(t, svc.RecoverPendingRotation())
	recovered, err := crypto.LoadVaultFile(crypto.VaultPath(dir))
	require.NoError(t, err)
	assert.Equal(t, oldVault, recovered)
	entry, err := store.GetSettingEntry(svc.db, securityRotationPendingSetting)
	require.NoError(t, err)
	assert.Nil(t, entry)
}

func TestRecoverPendingRotationClearsMarkerWhenDatabaseAndVaultRemainOld(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	svc := NewSecurityService(db, dir, NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	oldVault, _, err := crypto.CreateVault("old-password-12")
	require.NoError(t, err)
	nextVault, _, err := crypto.RotateVaultPassword("old-password-12", "next-password-12", oldVault, nil)
	require.NoError(t, err)
	require.NoError(t, crypto.SaveVaultFile(crypto.VaultPath(dir), oldVault))
	require.NoError(t, svc.writePendingRotation(securityRotationMarker{Version: securityRotationMarkerVersion, OldVault: oldVault, NewVault: nextVault}))

	require.NoError(t, svc.RecoverPendingRotation())
	entry, err := store.GetSettingEntry(svc.db, securityRotationPendingSetting)
	require.NoError(t, err)
	assert.Nil(t, entry)
}

func TestRecoverPendingRotationRejectsUnknownVaultState(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	svc := NewSecurityService(db, dir, NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	oldVault, _, err := crypto.CreateVault("old-password-12")
	require.NoError(t, err)
	nextVault, _, err := crypto.RotateVaultPassword("old-password-12", "next-password-12", oldVault, nil)
	require.NoError(t, err)
	unknownVault, _, err := crypto.CreateVault("unknown-password")
	require.NoError(t, err)
	require.NoError(t, crypto.SaveVaultFile(crypto.VaultPath(dir), unknownVault))
	require.NoError(t, svc.writePendingRotation(securityRotationMarker{Version: securityRotationMarkerVersion, OldVault: oldVault, NewVault: nextVault}))

	err = svc.RecoverPendingRotation()
	assert.ErrorContains(t, err, "unknown vault state")
	entry, err := store.GetSettingEntry(svc.db, securityRotationPendingSetting)
	require.NoError(t, err)
	assert.NotNil(t, entry)
}

func TestRotateClearsPendingMarkerWhenVaultSaveFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	svc := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := svc.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: false})
	require.NoError(t, err)
	svc.saveVaultFile = func(string, crypto.VaultFile) error { return errors.New("vault save failed") }

	_, err = svc.Rotate(model.SecurityRotateInput{CurrentPassword: "old-password-12", NewPassword: "next-password-12"})
	assert.ErrorContains(t, err, "vault save failed")
	entry, err := store.GetSettingEntry(svc.db, securityRotationPendingSetting)
	require.NoError(t, err)
	assert.Nil(t, entry)
	assert.Error(t, svc.VerifyPassword("next-password-12"))
	require.NoError(t, svc.VerifyPassword("old-password-12"))
}

func TestRotateRetainsPendingMarkerWhenVaultWasReplacedBeforeDurabilityError(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	svc := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := svc.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: false})
	require.NoError(t, err)
	sessions := NewSessionService(db, newMockEventBus(), 30, dir, runtime, testutil.NewTestLogger())
	created, err := sessions.CreateSession(model.SessionInputFrom(model.Session{
		Name: "durability", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "session-secret", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	before, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	durabilityErr := errors.New("directory sync failed after vault replace")
	svc.saveVaultFile = func(path string, vault crypto.VaultFile) error {
		if saveErr := crypto.SaveVaultFile(path, vault); saveErr != nil {
			return saveErr
		}
		return durabilityErr
	}

	_, err = svc.Rotate(model.SecurityRotateInput{
		CurrentPassword: "old-password-12",
		NewPassword:     "next-password-12",
	})

	require.ErrorIs(t, err, durabilityErr)
	entry, err := store.GetSettingEntry(db, securityRotationPendingSetting)
	require.NoError(t, err)
	require.NotNil(t, entry, "post-replace durability failure must retain the recovery marker")
	after, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, before.Password, after.Password)
	connected, err := sessions.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "session-secret", connected.Password)

	runtime.Clear()
	restartedRuntime := NewCryptoRuntime()
	restarted := NewSecurityService(db, dir, restartedRuntime, &memoryKeychain{}, testutil.NewTestLogger())
	require.NoError(t, restarted.RecoverPendingRotation())
	assertVaultPassword(t, dir, "old-password-12", true)
	assertVaultPassword(t, dir, "next-password-12", false)
	_, err = restarted.Unlock(model.SecurityUnlockInput{Password: "old-password-12"})
	require.NoError(t, err)
	restartedSessions := NewSessionService(db, newMockEventBus(), 30, dir, restartedRuntime, testutil.NewTestLogger())
	connected, err = restartedSessions.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "session-secret", connected.Password)
	entry, err = store.GetSettingEntry(db, securityRotationPendingSetting)
	require.NoError(t, err)
	assert.Nil(t, entry)
}

func TestRotateRestoresVaultWhenProtectedDataCommitFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	svc := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := svc.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: false})
	require.NoError(t, err)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, dir, runtime, testutil.NewTestLogger())
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "rotation", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "session-secret", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	before, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TRIGGER fail_rotation_password BEFORE UPDATE OF password ON sessions
		BEGIN SELECT RAISE(FAIL, 'forced rotation failure'); END`)
	require.NoError(t, err)

	_, err = svc.Rotate(model.SecurityRotateInput{CurrentPassword: "old-password-12", NewPassword: "next-password-12"})
	require.ErrorContains(t, err, "forced rotation failure")
	entry, err := store.GetSettingEntry(db, securityRotationPendingSetting)
	require.NoError(t, err)
	assert.Nil(t, entry)
	assert.NoError(t, svc.VerifyPassword("old-password-12"))
	assert.Error(t, svc.VerifyPassword("next-password-12"))
	after, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, before.Password, after.Password)
}

func TestRotateSerializesSessionPasswordWrites(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	security := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: false})
	require.NoError(t, err)
	sessions := NewSessionService(db, newMockEventBus(), 30, dir, runtime, testutil.NewTestLogger())

	saveStarted := make(chan struct{})
	releaseSave := make(chan struct{})
	security.saveVaultFile = func(path string, vault crypto.VaultFile) error {
		close(saveStarted)
		<-releaseSave
		return crypto.SaveVaultFile(path, vault)
	}

	rotationDone := make(chan error, 1)
	go func() {
		_, rotateErr := security.Rotate(model.SecurityRotateInput{
			CurrentPassword: "old-password-12",
			NewPassword:     "next-password-12",
		})
		rotationDone <- rotateErr
	}()
	<-saveStarted

	createDone := make(chan error, 1)
	go func() {
		_, createErr := sessions.CreateSession(model.SessionInputFrom(model.Session{
			Name: "serialized", Host: "127.0.0.1", Port: 22, Username: "root",
			AuthMethod: model.AuthPassword, Password: "session-secret", KeepAlive: 30, TermType: "xterm",
		}))
		createDone <- createErr
	}()
	select {
	case createErr := <-createDone:
		t.Fatalf("session write completed during password rotation: %v", createErr)
	case <-time.After(100 * time.Millisecond):
	}

	close(releaseSave)
	require.NoError(t, <-rotationDone)
	require.NoError(t, <-createDone)

	stored, err := store.ListSessions(db, nil)
	require.NoError(t, err)
	require.Len(t, stored, 1)
	password, err := openSessionPassword(runtime, stored[0].Password)
	require.NoError(t, err)
	assert.Equal(t, "session-secret", password)
}

func TestRotateSerializesKeyWrites(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	security := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: false})
	require.NoError(t, err)
	keys := NewKeyService(db, runtime, testutil.NewTestLogger())
	privateKey := generateTestPrivateKey(t)

	saveStarted := make(chan struct{})
	releaseSave := make(chan struct{})
	security.saveVaultFile = func(path string, vault crypto.VaultFile) error {
		close(saveStarted)
		<-releaseSave
		return crypto.SaveVaultFile(path, vault)
	}
	rotationDone := make(chan error, 1)
	go func() {
		_, rotateErr := security.Rotate(model.SecurityRotateInput{CurrentPassword: "old-password-12", NewPassword: "next-password-12"})
		rotationDone <- rotateErr
	}()
	<-saveStarted

	importDone := make(chan error, 1)
	go func() {
		_, importErr := keys.Import("serialized", privateKey)
		importDone <- importErr
	}()
	select {
	case importErr := <-importDone:
		t.Fatalf("key write completed during password rotation: %v", importErr)
	case <-time.After(100 * time.Millisecond):
	}

	close(releaseSave)
	require.NoError(t, <-rotationDone)
	require.NoError(t, <-importDone)
	stored, err := store.ListKeys(db)
	require.NoError(t, err)
	require.Len(t, stored, 1)
	full, err := store.GetKey(db, stored[0].ID)
	require.NoError(t, err)
	_, err = runtime.Decrypt([]byte(full.PrivateKey))
	require.NoError(t, err)
}

func TestRotateSerializesProxyPasswordWrites(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	security := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: false})
	require.NoError(t, err)
	settings := NewSettingService(db, testutil.NewTestLogger(), SettingServiceOptions{Crypto: runtime})
	rotationDone, releaseSave := startBlockedRotation(t, security)

	writeDone := make(chan error, 1)
	go func() {
		writeDone <- settings.Set(model.SettingInput{
			Key: applicationProxyPasswordSetting, Namespace: "application", Value: `"proxy-secret"`, ValueType: "string", Version: 1,
		})
	}()
	assertWriteBlocked(t, writeDone, "proxy password")

	close(releaseSave)
	require.NoError(t, <-rotationDone)
	require.NoError(t, <-writeDone)
	password, saved, err := settings.loadProxyPassword()
	require.NoError(t, err)
	assert.True(t, saved)
	assert.Equal(t, "proxy-secret", password)
}

func TestRotateSerializesSyncCredentialWrites(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	security := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: false})
	require.NoError(t, err)
	syncService := NewSyncService(db, testutil.NewTestLogger(), WithSyncCrypto(runtime))
	rotationDone, releaseSave := startBlockedRotation(t, security)

	writeDone := make(chan error, 1)
	go func() { writeDone <- syncService.saveSecret(syncGistTokenSetting, "gist-token") }()
	assertWriteBlocked(t, writeDone, "sync credential")

	close(releaseSave)
	require.NoError(t, <-rotationDone)
	require.NoError(t, <-writeDone)
	secret, err := syncService.loadSecret(syncGistTokenSetting)
	require.NoError(t, err)
	assert.Equal(t, "gist-token", secret)
}

func startBlockedRotation(t *testing.T, security *SecurityService) (<-chan error, chan<- struct{}) {
	t.Helper()
	saveStarted := make(chan struct{})
	releaseSave := make(chan struct{})
	security.saveVaultFile = func(path string, vault crypto.VaultFile) error {
		close(saveStarted)
		<-releaseSave
		return crypto.SaveVaultFile(path, vault)
	}
	rotationDone := make(chan error, 1)
	go func() {
		_, rotateErr := security.Rotate(model.SecurityRotateInput{CurrentPassword: "old-password-12", NewPassword: "next-password-12"})
		rotationDone <- rotateErr
	}()
	<-saveStarted
	return rotationDone, releaseSave
}

func assertWriteBlocked(t *testing.T, writeDone <-chan error, description string) {
	t.Helper()
	select {
	case writeErr := <-writeDone:
		t.Fatalf("%s completed during password rotation: %v", description, writeErr)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestDecodeRotationMarkerRejectsInvalidPayloads(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{name: "malformed", raw: "{"},
		{name: "unsupported version", raw: `{"version":2}`},
		{name: "incomplete", raw: `{"version":1,"old_vault":{},"new_vault":{}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := decodeRotationMarker(test.raw)
			assert.Error(t, err)
		})
	}
}
