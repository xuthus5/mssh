package service

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

type syncVaultErrorProviderFactory struct {
	err      error
	provider syncProvider
}

func (f syncVaultErrorProviderFactory) Create(context.Context, model.SyncConfig, syncProviderSecrets) (syncProvider, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.provider, nil
}

func TestSyncVaultOperationsRejectBusyState(t *testing.T) {
	service := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()))
	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	path := filepath.Join(t.TempDir(), "backup.msshbackup")
	assert.ErrorContains(t, service.ImportWithPassword(path, "unused-password-12"), "sync operation is already running")
	assert.ErrorContains(t, service.AdoptVaultFromContent("unused-password-12", nil), "sync operation is already running")
	_, err := service.JoinWithPassword(model.SyncConfigInput{}, "unused-password-12")
	assert.ErrorContains(t, err, "sync operation is already running")
}

func TestImportWithPasswordSupportsLegacyArtifactUnderCryptoGate(t *testing.T) {
	db := testutil.NewTestDB(t)
	secret := syncTestMasterKey
	service := newTestSyncService(db, secret, WithSyncDataDir(t.TempDir()))
	data, err := service.snapshot()
	require.NoError(t, err)
	content, err := encodeEncryptedSnapshot(data, secret)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "legacy.msshbackup")
	require.NoError(t, writePrivateFileAtomic(path, content))
	require.NoError(t, service.ImportWithPassword(path, "legacy-password-12"))

	broken, err := encodeEncryptedSnapshot(data, "different-master-key")
	require.NoError(t, err)
	require.NoError(t, writePrivateFileAtomic(path, broken))
	assert.Error(t, service.ImportWithPassword(path, "legacy-password-12"))
}

func TestImportWithPasswordRejectsRestoreSetupAndCommitFailures(t *testing.T) {
	t.Run("snapshot validation", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		content, vault, secret := passwordArtifactForTest(t, db, "import-validation-pass-12", func(data *ExportData) {
			data.Tables["sessions"] = append(data.Tables["sessions"], map[string]any{"unknown_column": "blocked"})
		})
		installerCalled := false
		service := newTestSyncService(db, secret, WithSyncDataDir(t.TempDir()), WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			installerCalled = true
			return &stubVaultInstallTransaction{}, nil
		}))
		path := writeSyncVaultTestArtifact(t, content)
		assert.Error(t, service.ImportWithPassword(path, "import-validation-pass-12"))
		assert.False(t, installerCalled)
		_ = vault
	})

	t.Run("destructive preparation", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		content, _, secret := passwordArtifactForTest(t, db, "import-prepare-pass-12", nil)
		service := newTestSyncService(db, secret, WithSyncDataDir(t.TempDir()), WithSyncLifecycle(errorLifecycle{}), WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{}, nil
		}))
		assert.ErrorContains(t, service.ImportWithPassword(writeSyncVaultTestArtifact(t, content), "import-prepare-pass-12"), "prepare")
	})

	t.Run("installer returns no transaction", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		vault, _, err := backupcrypto.CreateVault("import-installer-pass-12")
		require.NoError(t, err)
		service := NewSyncService(db, testutil.NewTestLogger(), WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return nil, nil
		}))
		_, err = service.prepareVaultInstall("import-installer-pass-12", vault)
		assert.ErrorContains(t, err, "returned no transaction")
	})

	t.Run("commit failure rolls back", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		content, _, secret := passwordArtifactForTest(t, db, "import-commit-pass-12", nil)
		rolledBack := false
		service := newTestSyncService(db, secret, WithSyncDataDir(t.TempDir()), WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{commit: func() error { return assert.AnError }, rollback: func() error { rolledBack = true; return nil }}, nil
		}))
		assert.Error(t, service.ImportWithPassword(writeSyncVaultTestArtifact(t, content), "import-commit-pass-12"))
		assert.True(t, rolledBack)
	})
}

func TestJoinWithPasswordRejectsProviderAndRestoreFailures(t *testing.T) {
	validInput := syncVaultJoinInput()
	t.Run("invalid provider and readiness", func(t *testing.T) {
		service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
		bad := validInput
		bad.Provider = "invalid"
		_, err := service.JoinWithPassword(bad, "join-invalid-pass-12")
		assert.Error(t, err)
		bad = validInput
		bad.Provider = model.SyncProviderGist
		bad.Gist.Token = ""
		_, err = service.JoinWithPassword(bad, "join-invalid-pass-12")
		assert.Error(t, err)
	})

	t.Run("provider factory and fetch", func(t *testing.T) {
		factoryError := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey, WithSyncProviderFactory(syncVaultErrorProviderFactory{err: assert.AnError}))
		_, err := factoryError.JoinWithPassword(validInput, "join-provider-pass-12")
		assert.ErrorIs(t, err, assert.AnError)
		fetchError := &failingSyncProvider{fetchErr: assert.AnError}
		fetchFailure := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey, WithSyncProviderFactory(failingSyncProviderFactory{fetchError}))
		_, err = fetchFailure.JoinWithPassword(validInput, "join-provider-pass-12")
		assert.ErrorIs(t, err, assert.AnError)
	})

	t.Run("decode and validation", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		content, _, secret := passwordArtifactForTest(t, db, "join-decode-pass-12", nil)
		provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content}}
		service := newTestSyncService(db, secret, WithSyncProviderFactory(fakeSyncProviderFactory{provider}), WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{}, nil
		}))
		assert.Error(t, func() error {
			_, err := service.JoinWithPassword(validInput, "wrong-join-pass-12")
			return err
		}())
		invalidContent, _, _ := passwordArtifactForTest(t, db, "join-decode-pass-12", func(data *ExportData) {
			data.Tables["sessions"] = append(data.Tables["sessions"], map[string]any{"unknown_column": "blocked"})
		})
		provider.remote.Content = invalidContent
		_, err := service.JoinWithPassword(validInput, "join-decode-pass-12")
		assert.Error(t, err)
	})

	t.Run("lifecycle and installer", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		content, _, secret := passwordArtifactForTest(t, db, "join-setup-pass-12", nil)
		provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content}}
		lifecycleFailure := newTestSyncService(db, secret, WithSyncProviderFactory(fakeSyncProviderFactory{provider}), WithSyncLifecycle(errorLifecycle{}), WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{}, nil
		}))
		assert.Error(t, mustJoin(lifecycleFailure, validInput, "join-setup-pass-12"))
		installerFailure := newTestSyncService(db, secret, WithSyncProviderFactory(fakeSyncProviderFactory{provider}), WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return nil, assert.AnError
		}))
		assert.ErrorIs(t, mustJoin(installerFailure, validInput, "join-setup-pass-12"), assert.AnError)
	})

	t.Run("commit failure and successful restore", func(t *testing.T) {
		db := testutil.NewTestDB(t)
		content, _, secret := passwordArtifactForTest(t, db, "join-commit-pass-12", nil)
		provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content}}
		service := newTestSyncService(db, secret, WithSyncProviderFactory(fakeSyncProviderFactory{provider}), WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{commit: func() error { return assert.AnError }}, nil
		}))
		assert.ErrorIs(t, mustJoin(service, validInput, "join-commit-pass-12"), assert.AnError)

		provider.remote.Content = content
		success := newTestSyncService(testutil.NewTestDB(t), secret, WithSyncProviderFactory(fakeSyncProviderFactory{provider}), WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{}, nil
		}))
		_, err := success.JoinWithPassword(validInput, "join-commit-pass-12")
		require.NoError(t, err)
	})
}

func passwordArtifactForTest(t *testing.T, db *sql.DB, password string, mutate func(*ExportData)) ([]byte, backupcrypto.VaultFile, string) {
	t.Helper()
	vault, dek, err := backupcrypto.CreateVault(password)
	require.NoError(t, err)
	secret := backupcrypto.SyncSecretFromDEK(dek)
	service := newTestSyncService(db, secret)
	data, err := service.snapshot()
	require.NoError(t, err)
	if mutate != nil {
		mutate(&data)
	}
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, secret, syncArtifactMetadata{SnapshotFingerprint: fingerprint}, &vault)
	require.NoError(t, err)
	return content, vault, secret
}

func writeSyncVaultTestArtifact(t *testing.T, content []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "vault-backup.msshbackup")
	require.NoError(t, writePrivateFileAtomic(path, content))
	return path
}

func syncVaultJoinInput() model.SyncConfigInput {
	return model.SyncConfigInput{
		Enabled: false, Provider: model.SyncProviderWebDAV, Strategy: model.SyncStrategySmart,
		IntervalMinutes: 0, RetentionCount: 30, RetentionDays: 90,
		WebDAV: model.WebDAVSyncConfigInput{URL: "https://dav.example/backups"},
	}
}

func mustJoin(service *SyncService, input model.SyncConfigInput, password string) error {
	_, err := service.JoinWithPassword(input, password)
	return err
}
