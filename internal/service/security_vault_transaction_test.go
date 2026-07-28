package service

import (
	"database/sql"
	"os"
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

func TestPrepareVaultFromExportDefersUnlockCallbackAndRollsBack(t *testing.T) {
	sourceDB := testutil.NewTestDB(t)
	source := NewSecurityService(sourceDB, t.TempDir(), NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	_, err := source.Setup(model.SecuritySetupInput{Password: "transaction-pass-12", RememberUnlock: false})
	require.NoError(t, err)
	vault, err := source.ExportVaultFile()
	require.NoError(t, err)

	targetDir := t.TempDir()
	targetRuntime := NewCryptoRuntime()
	target := NewSecurityService(testutil.NewTestDB(t), targetDir, targetRuntime, &memoryKeychain{}, testutil.NewTestLogger())
	callbackCalls := 0
	target.SetAfterUnlock(func() { callbackCalls++ })
	transaction, err := target.PrepareVaultFromExport("transaction-pass-12", vault)
	require.NoError(t, err)
	require.NotNil(t, transaction)
	if callbackCalls != 0 {
		t.Fatalf("unlock callback ran before transaction commit: %d", callbackCalls)
	}
	require.NoError(t, transaction.Rollback())
	if crypto.VaultExists(targetDir) || targetRuntime.Unlocked() {
		t.Fatal("vault transaction rollback left installed state")
	}

	transaction, err = target.PrepareVaultFromExport("transaction-pass-12", vault)
	require.NoError(t, err)
	require.NoError(t, transaction.Commit())
	if callbackCalls != 1 {
		t.Fatalf("expected one unlock callback after commit, got %d", callbackCalls)
	}
}

func TestPrepareVaultFromExportHoldsCryptoGateUntilCommit(t *testing.T) {
	source := NewSecurityService(testutil.NewTestDB(t), t.TempDir(), NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	_, err := source.Setup(model.SecuritySetupInput{Password: "transaction-gate-12", RememberUnlock: false})
	require.NoError(t, err)
	vault, err := source.ExportVaultFile()
	require.NoError(t, err)

	runtime := NewCryptoRuntime()
	target := NewSecurityService(testutil.NewTestDB(t), t.TempDir(), runtime, &memoryKeychain{}, testutil.NewTestLogger())
	transaction, err := target.PrepareVaultFromExport("transaction-gate-12", vault)
	require.NoError(t, err)
	gateAcquired := make(chan struct{})
	gateDone := make(chan error, 1)
	go func() {
		gateDone <- runtime.WithCryptoOperation(func() error {
			close(gateAcquired)
			return nil
		})
	}()
	select {
	case <-gateAcquired:
		t.Fatal("crypto gate was released before vault transaction commit")
	case <-time.After(100 * time.Millisecond):
	}

	require.NoError(t, transaction.Commit())
	select {
	case <-gateAcquired:
	case <-time.After(time.Second):
		t.Fatal("crypto gate remained locked after vault transaction commit")
	}
	require.NoError(t, <-gateDone)
}

func TestVaultInstallTransactionStateTransitions(t *testing.T) {
	commitCalls := 0
	transaction := &vaultInstallTransaction{
		commit:   func() error { commitCalls++; return nil },
		rollback: func() error { return nil },
	}
	operationCalls := 0
	require.NoError(t, transaction.WithCryptoOperation(func() error { operationCalls++; return nil }))
	require.NoError(t, transaction.Commit())
	require.NoError(t, transaction.Commit())
	assert.Equal(t, 1, operationCalls)
	assert.Equal(t, 1, commitCalls)
	assert.ErrorIs(t, transaction.WithCryptoOperation(func() error { return nil }), errVaultInstallTransactionClosed)
	assert.ErrorIs(t, transaction.Rollback(), errVaultInstallTransactionClosed)

	transaction = &vaultInstallTransaction{commit: func() error { return nil }, rollback: func() error { return nil }}
	require.NoError(t, transaction.Rollback())
	require.NoError(t, transaction.Rollback())
	assert.ErrorIs(t, transaction.Commit(), errVaultInstallTransactionClosed)
	assert.ErrorIs(t, transaction.WithCryptoOperation(func() error { return nil }), errVaultInstallTransactionClosed)

	transaction = &vaultInstallTransaction{commit: func() error { return assert.AnError }, rollback: func() error { return nil }}
	assert.ErrorIs(t, transaction.Commit(), assert.AnError)
	require.NoError(t, transaction.Rollback())
}

func TestVaultInstallStateErrorPaths(t *testing.T) {
	t.Run("capture failures", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		runtime := NewCryptoRuntime()
		service := NewSecurityService(db, t.TempDir(), runtime, unavailableKeychain{}, testutil.NewTestLogger())
		state, err := service.captureVaultInstallState(runtime)
		require.NoError(t, err)
		assert.False(t, state.keychainOK)

		service = NewSecurityService(db, t.TempDir(), runtime, &failingGetKeychain{}, testutil.NewTestLogger())
		_, err = service.captureVaultInstallState(runtime)
		assert.ErrorContains(t, err, "capture remembered unlock")

		corruptDir := t.TempDir()
		require.NoError(t, os.WriteFile(crypto.VaultPath(corruptDir), []byte("{"), 0o600))
		service = NewSecurityService(db, corruptDir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
		_, err = service.captureVaultInstallState(runtime)
		assert.ErrorContains(t, err, "capture current vault")

		require.NoError(t, db.Close())
		_, err = service.captureVaultInstallState(runtime)
		assert.ErrorContains(t, err, "capture vault preferences")
	})

	t.Run("restore failures", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		runtime := NewCryptoRuntime()
		vault, _, err := crypto.CreateVault("restore-state-pass-12")
		require.NoError(t, err)
		service := NewSecurityService(db, t.TempDir(), runtime, &failingDeleteKeychain{}, testutil.NewTestLogger())
		service.saveVaultFile = func(string, crypto.VaultFile) error { return assert.AnError }
		state := vaultInstallState{
			vault: &vault, settings: map[string]model.Setting{}, keychainOK: true,
			keychain: map[string][]byte{securityKeychainDEKAccount: []byte("dek")},
		}
		err = service.restoreVaultInstallState(runtime, state)
		assert.Error(t, err)

		nonEmptyVaultPath := filepath.Join(t.TempDir(), crypto.VaultFileName)
		require.NoError(t, os.MkdirAll(filepath.Join(nonEmptyVaultPath, "child"), 0o700))
		service = NewSecurityService(db, filepath.Dir(nonEmptyVaultPath), runtime, &memoryKeychain{}, testutil.NewTestLogger())
		assert.Error(t, service.restoreVaultRuntime(runtime, vaultInstallState{}))
		require.NoError(t, service.restoreVaultKeychain(vaultInstallState{}))

		require.NoError(t, db.Close())
		assert.ErrorContains(t, service.restoreVaultPreferences(nil), "begin vault preference rollback")
	})

	t.Run("preference statement failures", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		service := NewSecurityService(db, t.TempDir(), NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
		require.NoError(t, service.savePreferences(false, false))
		require.NoError(t, mustExec(db, `CREATE TRIGGER fail_security_preference_update BEFORE INSERT ON settings
			WHEN NEW.key = 'security.require_password_on_launch' BEGIN SELECT RAISE(FAIL, 'update blocked'); END`))
		settings, err := store.GetSettings(db, []string{securityRequireLaunchSetting})
		require.NoError(t, err)
		assert.ErrorContains(t, service.restoreVaultPreferences(settings), "restore vault preference")
		require.NoError(t, mustExec(db, "DROP TRIGGER fail_security_preference_update"))
		require.NoError(t, mustExec(db, `CREATE TRIGGER fail_security_preference_delete BEFORE DELETE ON settings
			WHEN OLD.key = 'security.require_password_on_launch' BEGIN SELECT RAISE(FAIL, 'delete blocked'); END`))
		assert.ErrorContains(t, service.restoreVaultPreferences(map[string]model.Setting{}), "delete vault preference")
	})
}

func mustExec(db interface {
	Exec(string, ...any) (sql.Result, error)
}, statement string) error {
	_, err := db.Exec(statement)
	return err
}
