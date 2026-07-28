package service

import (
	"database/sql"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestImportWithPasswordReturnsVaultRollbackFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	content, _, secret := passwordArtifactForTest(t, db, "import-rollback-pass-12", nil)
	restoreErr := errors.New("restore failed")
	rollbackErr := errors.New("vault rollback failed")
	service := newTestSyncService(
		db,
		secret,
		WithSyncDataDir(t.TempDir()),
		WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{
				operation: func(func() error) error { return restoreErr },
				rollback:  func() error { return rollbackErr },
			}, nil
		}),
	)

	err := service.ImportWithPassword(writeSyncVaultTestArtifact(t, content), "import-rollback-pass-12")

	require.Error(t, err)
	assert.ErrorIs(t, err, restoreErr)
	assert.ErrorIs(t, err, rollbackErr)
}

func TestJoinWithPasswordReturnsVaultRollbackFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	content, _, secret := passwordArtifactForTest(t, db, "join-rollback-pass-12", nil)
	restoreErr := errors.New("join restore failed")
	rollbackErr := errors.New("join vault rollback failed")
	provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content}}
	service := newTestSyncService(
		db,
		secret,
		WithSyncDataDir(t.TempDir()),
		WithSyncProviderFactory(fakeSyncProviderFactory{provider}),
		WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{
				operation: func(func() error) error { return restoreErr },
				rollback:  func() error { return rollbackErr },
			}, nil
		}),
	)

	_, err := service.JoinWithPassword(syncVaultJoinInput(), "join-rollback-pass-12")

	require.Error(t, err)
	assert.ErrorIs(t, err, restoreErr)
	assert.ErrorIs(t, err, rollbackErr)
}

func TestImportWithPasswordRestoresDataWhenVaultCommitFails(t *testing.T) {
	sourceDB := testutil.NewTestDB(t)
	createSyncRollbackSession(t, sourceDB, "remote")
	content, _, secret := passwordArtifactForTest(t, sourceDB, "import-commit-rollback-12", nil)
	targetDB := testutil.NewTestDB(t)
	createSyncRollbackSession(t, targetDB, "local")
	commitErr := errors.New("vault commit failed")
	service := newTestSyncService(
		targetDB,
		secret,
		WithSyncDataDir(t.TempDir()),
		WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{commit: func() error { return commitErr }}, nil
		}),
	)

	err := service.ImportWithPassword(writeSyncVaultTestArtifact(t, content), "import-commit-rollback-12")

	require.ErrorIs(t, err, commitErr)
	assert.Equal(t, []string{"local"}, syncSessionNames(t, targetDB))
}

func TestJoinWithPasswordRestoresDataAndSettingsWhenVaultCommitFails(t *testing.T) {
	sourceDB := testutil.NewTestDB(t)
	createSyncRollbackSession(t, sourceDB, "remote")
	content, _, secret := passwordArtifactForTest(t, sourceDB, "join-commit-rollback-12", nil)
	targetDB := testutil.NewTestDB(t)
	createSyncRollbackSession(t, targetDB, "local")
	previousConfig := defaultSyncConfig()
	previousConfig.Enabled = true
	previousConfig.Gist.GistID = "existing-gist"
	require.NoError(t, writeSyncSetting(targetDB, syncConfigSetting, previousConfig))
	beforeSettings := syncRollbackSettingValues(t, targetDB)
	provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content}}
	commitErr := errors.New("join vault commit failed")
	service := newTestSyncService(
		targetDB,
		secret,
		WithSyncDataDir(t.TempDir()),
		WithSyncProviderFactory(fakeSyncProviderFactory{provider}),
		WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{commit: func() error { return commitErr }}, nil
		}),
	)

	_, err := service.JoinWithPassword(syncVaultJoinInput(), "join-commit-rollback-12")

	require.ErrorIs(t, err, commitErr)
	assert.Equal(t, []string{"local"}, syncSessionNames(t, targetDB))
	assert.Equal(t, beforeSettings, syncRollbackSettingValues(t, targetDB))
}

func TestRollbackVaultRestoreReturnsCompensationAndVaultErrors(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey)
	data, err := service.snapshot()
	require.NoError(t, err)
	require.NoError(t, db.Close())
	cause := errors.New("vault commit failed")
	rollbackErr := errors.New("vault rollback failed")
	transaction := &stubVaultInstallTransaction{rollback: func() error { return rollbackErr }}

	err = service.rollbackVaultRestore(transaction, passwordRestoreState{data: data}, cause)

	require.Error(t, err)
	assert.ErrorIs(t, err, cause)
	assert.ErrorIs(t, err, rollbackErr)
	assert.ErrorContains(t, err, "restore pre-import data")
}

func TestRestorePasswordStateRejectsInvalidPreviousSetting(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey)
	data, err := service.snapshot()
	require.NoError(t, err)
	state := passwordRestoreState{
		data: data,
		syncSettings: []model.Setting{{
			Key: "invalid", Namespace: "sync", Value: `"value"`, ValueType: "string", Version: 1,
		}},
		restoreSyncSettings: true,
	}

	err = service.restorePasswordState(state)

	assert.ErrorContains(t, err, "restore joined sync settings")
}

func createSyncRollbackSession(t *testing.T, db *sql.DB, name string) {
	t.Helper()
	_, err := store.CreateSession(db, model.Session{
		Name: name, Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthAgent, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
}

func syncRollbackSettingValues(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	settings, err := store.ListSettings(db, "sync")
	require.NoError(t, err)
	values := make(map[string]string, len(settings))
	for _, setting := range settings {
		values[setting.Key] = setting.Value
	}
	return values
}
