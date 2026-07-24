package service

import (
	"errors"
	"testing"

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
