package service

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSecuritySetupRollsBackVaultAndRuntimeWhenPreferencesFail(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	service := NewSecurityService(db, dir, runtime, keychain, testutil.NewTestLogger())
	installRememberPreferenceFailure(t, db)

	_, err := service.Setup(model.SecuritySetupInput{
		Password: "initial-pass-12", RememberUnlock: true,
	})

	require.ErrorContains(t, err, "remember preference write failed")
	assert.False(t, crypto.VaultExists(dir))
	assert.False(t, runtime.Unlocked())
	settings, err := store.GetSettings(db, []string{securityRequireLaunchSetting, securityRememberUnlockSetting})
	require.NoError(t, err)
	assert.Empty(t, settings)
	assert.Empty(t, keychain.data)
}

func TestSecurityUnlockRollsBackRuntimeWhenPreferencesFail(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	service := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := service.Setup(model.SecuritySetupInput{
		Password: "initial-pass-12", RememberUnlock: false,
	})
	require.NoError(t, err)
	_, err = service.Lock()
	require.NoError(t, err)
	installRememberPreferenceFailure(t, db)

	_, err = service.Unlock(model.SecurityUnlockInput{
		Password: "initial-pass-12", RememberUnlock: true,
	})

	require.ErrorContains(t, err, "remember preference write failed")
	assert.False(t, runtime.Unlocked())
	assert.False(t, service.boolSetting(securityRememberUnlockSetting, true))
	assert.NoError(t, service.VerifyPassword("initial-pass-12"))
}

func installRememberPreferenceFailure(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`CREATE TRIGGER fail_remember_preference
		BEFORE INSERT ON settings
		WHEN NEW.key = 'security.remember_unlock' AND NEW.value = 'true'
		BEGIN SELECT RAISE(FAIL, 'remember preference write failed'); END`)
	require.NoError(t, err)
}
