package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSecurityService_TryAutoUnlockRejectsDEKForDifferentVault(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	security := NewSecurityService(db, dir, runtime, keychain, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: true})
	require.NoError(t, err)

	otherVault, _, err := crypto.CreateVault("other-password-12")
	require.NoError(t, err)
	require.NoError(t, crypto.SaveVaultFile(crypto.VaultPath(dir), otherVault))
	runtime.Clear()

	require.NoError(t, security.TryAutoUnlock())
	assert.False(t, runtime.Unlocked())
	assert.Empty(t, keychain.data[securityKeychainDEKAccount])
}

func TestSecurityService_TryAutoUnlockRejectsFingerprintDEKMismatch(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	security := NewSecurityService(db, dir, runtime, keychain, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)
	require.Len(t, keychain.data[securityKeychainDEKAccount], 32)
	require.NotEmpty(t, keychain.data[securityKeychainVaultAccount])
	wrongDEK := append([]byte(nil), keychain.data[securityKeychainDEKAccount]...)
	wrongDEK[0] ^= 0xff
	keychain.data[securityKeychainDEKAccount] = wrongDEK
	runtime.Clear()

	require.NoError(t, security.TryAutoUnlock())

	assert.False(t, runtime.Unlocked())
	assert.Empty(t, keychain.data[securityKeychainDEKAccount])
	assert.Empty(t, keychain.data[securityKeychainVaultAccount])
}

func TestSecurityService_SavePreferencesWaitsForPasswordRotation(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	security := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: true})
	require.NoError(t, err)

	rotationDone, releaseSave := startBlockedRotation(t, security)
	preferencesDone := make(chan error, 1)
	go func() {
		_, preferencesErr := security.SavePreferences(model.SecurityPreferenceInput{
			RequirePasswordOnLaunch: false,
			RememberUnlock:          true,
		})
		preferencesDone <- preferencesErr
	}()
	bypassed := false
	select {
	case <-preferencesDone:
		bypassed = true
	case <-time.After(100 * time.Millisecond):
	}

	close(releaseSave)
	require.NoError(t, <-rotationDone)
	if bypassed {
		t.Fatal("preferences update bypassed password rotation")
	}
	require.NoError(t, <-preferencesDone)
}

func TestSecurityService_SavePreferencesWithoutRuntimeFailsClosed(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSecurityService(db, t.TempDir(), nil, &memoryKeychain{}, testutil.NewTestLogger())

	status, err := service.SavePreferences(model.SecurityPreferenceInput{
		RequirePasswordOnLaunch: false,
		RememberUnlock:          true,
	})

	require.NoError(t, err)
	assert.False(t, status.Unlocked)
	assert.False(t, status.RememberUnlock)
}

func TestSecurityService_SyncSecretWithoutRuntimeReturnsVaultLocked(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSecurityService(db, t.TempDir(), nil, &memoryKeychain{}, testutil.NewTestLogger())

	_, err := service.SyncSecret()

	require.ErrorIs(t, err, ErrVaultLocked)
}

func TestSecurityService_InstallVaultWithoutRuntimeReturnsVaultLocked(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	service := NewSecurityService(db, dir, nil, &memoryKeychain{}, testutil.NewTestLogger())
	vault, _, err := crypto.CreateVault("initial-pass-12")
	require.NoError(t, err)

	err = service.InstallVaultFromExport("initial-pass-12", vault)

	require.ErrorIs(t, err, ErrVaultLocked)
	assert.False(t, crypto.VaultExists(dir))
}
