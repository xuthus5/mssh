package service

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestImportWithPasswordRollsBackVaultWhenSnapshotValidationFails(t *testing.T) {
	password := "transaction-pass-12"
	sourceDB := testutil.NewTestDB(t)
	sourceDir := t.TempDir()
	sourceRuntime := NewCryptoRuntime()
	sourceSecurity := NewSecurityService(sourceDB, sourceDir, sourceRuntime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := sourceSecurity.Setup(model.SecuritySetupInput{Password: password, RememberUnlock: false})
	require.NoError(t, err)
	secret, err := sourceSecurity.SyncSecret()
	require.NoError(t, err)
	vault, err := sourceSecurity.ExportVaultFile()
	require.NoError(t, err)

	sourceSync := newTestSyncService(sourceDB, secret, WithVaultSource(func() (*backupcrypto.VaultFile, error) {
		return &vault, nil
	}))
	_, err = store.CreateSession(sourceDB, model.Session{Name: "duplicate", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent})
	require.NoError(t, err)
	data, err := sourceSync.snapshot()
	require.NoError(t, err)
	data.Tables["sessions"] = append(data.Tables["sessions"], data.Tables["sessions"][0])
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, secret, syncArtifactMetadata{SnapshotFingerprint: fingerprint}, &vault)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "invalid.msshbackup")
	require.NoError(t, writePrivateFileAtomic(path, content))

	targetDB := testutil.NewTestDB(t)
	targetDir := t.TempDir()
	targetRuntime := NewCryptoRuntime()
	targetSecurity := NewSecurityService(targetDB, targetDir, targetRuntime, &memoryKeychain{}, testutil.NewTestLogger())
	targetSync := newTestSyncService(targetDB, "unused", WithSyncCrypto(targetRuntime),
		WithSyncSecretSource(targetSecurity.SyncSecret), WithVaultTransactionInstaller(targetSecurity.PrepareVaultFromExport))

	err = targetSync.ImportWithPassword(path, password)
	require.Error(t, err)
	assert.False(t, backupcrypto.VaultExists(targetDir))
	assert.False(t, targetRuntime.Unlocked())
}

func TestJoinWithPasswordRollsBackVaultAndConfigWhenRestoreFails(t *testing.T) {
	password := "join-transaction-12"
	sourceDB := testutil.NewTestDB(t)
	sourceDir := t.TempDir()
	sourceRuntime := NewCryptoRuntime()
	sourceSecurity := NewSecurityService(sourceDB, sourceDir, sourceRuntime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := sourceSecurity.Setup(model.SecuritySetupInput{Password: password, RememberUnlock: false})
	require.NoError(t, err)
	secret, err := sourceSecurity.SyncSecret()
	require.NoError(t, err)
	vault, err := sourceSecurity.ExportVaultFile()
	require.NoError(t, err)
	sourceSync := newTestSyncService(sourceDB, secret, WithVaultSource(func() (*backupcrypto.VaultFile, error) {
		return &vault, nil
	}))
	_, err = store.CreateSession(sourceDB, model.Session{Name: "duplicate", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent})
	require.NoError(t, err)
	data, err := sourceSync.snapshot()
	require.NoError(t, err)
	data.Tables["sessions"] = append(data.Tables["sessions"], data.Tables["sessions"][0])
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, secret, syncArtifactMetadata{SnapshotFingerprint: fingerprint}, &vault)
	require.NoError(t, err)

	targetDB := testutil.NewTestDB(t)
	targetDir := t.TempDir()
	targetRuntime := NewCryptoRuntime()
	targetSecurity := NewSecurityService(targetDB, targetDir, targetRuntime, &memoryKeychain{}, testutil.NewTestLogger())
	provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content, ETag: "etag"}}
	targetSync := newTestSyncService(targetDB, "unused", WithSyncCrypto(targetRuntime),
		WithSyncSecretSource(targetSecurity.SyncSecret),
		WithVaultTransactionInstaller(targetSecurity.PrepareVaultFromExport),
		WithSyncProviderFactory(fakeSyncProviderFactory{provider}))
	input := model.SyncConfigInput{
		Enabled: true, Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart,
		IntervalMinutes: 15, RetentionCount: 30, RetentionDays: 90,
		Gist: model.GistSyncConfigInput{GistID: "gist", Token: "token"},
	}

	_, err = targetSync.JoinWithPassword(input, password)
	require.Error(t, err)
	assert.False(t, backupcrypto.VaultExists(targetDir))
	assert.False(t, targetRuntime.Unlocked())
	config, configErr := targetSync.LoadConfig()
	require.NoError(t, configErr)
	assert.False(t, config.Enabled)
}

func TestImportWithPasswordRecordsAuditOutcome(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetAuditEnabled(db, true))
	runtime := NewCryptoRuntime()
	password := "audit-import-pass-12"
	vault, dek, err := backupcrypto.CreateVault(password)
	require.NoError(t, err)
	runtime.SetDEK(dek)
	secret := backupcrypto.SyncSecretFromDEK(dek)
	service := newTestSyncService(db, secret,
		WithSyncCrypto(runtime),
		WithSyncDataDir(t.TempDir()),
		WithVaultTransactionInstaller(func(string, backupcrypto.VaultFile) (VaultInstallTransaction, error) {
			return &stubVaultInstallTransaction{}, nil
		}),
	)
	data, err := service.snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, secret, syncArtifactMetadata{SnapshotFingerprint: fingerprint}, &vault)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "audit-import.msshbackup")
	require.NoError(t, writePrivateFileAtomic(path, content))

	require.NoError(t, service.ImportWithPassword(path, password))
	events, err := store.ListAuditEvents(db, model.AuditFilter{Action: "import", Limit: 10})
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, "success", events[0].Outcome)

	assert.Error(t, service.ImportWithPassword(path, "wrong-audit-pass-12"))
	events, err = store.ListAuditEvents(db, model.AuditFilter{Action: "import", Limit: 10})
	require.NoError(t, err)
	require.Len(t, events, 2)
	assert.Equal(t, "failed", events[0].Outcome)
	assert.NotContains(t, events[0].Summary, password)
}
