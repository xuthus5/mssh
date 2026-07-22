package service

import (
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

func TestStoreSyncVersionHelpersErrorPaths(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetSyncVersionProtected(db, 1, true))
	require.NoError(t, store.DeleteSyncVersion(db, 1))
	require.NoError(t, db.Close())
	assert.Error(t, store.SetSyncVersionProtected(db, 1, true))
	assert.Error(t, store.DeleteSyncVersion(db, 1))
}

func TestSyncSaveVersionProtectExistingDBError(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()),
		WithSyncSecretSource(func() (string, error) { return "secret-from-vault-xx", nil }),
	)
	meta := syncArtifactMetadata{VersionID: "p1", SnapshotFingerprint: "fp-p1", CreatedAt: time.Now().UTC()}
	_, err := svc.saveVersion([]byte("a"), meta, model.SyncProviderGist, "manual", false)
	require.NoError(t, err)
	require.NoError(t, db.Close())
	_, err = svc.saveVersion([]byte("a"), meta, model.SyncProviderGist, "manual", true)
	assert.Error(t, err)
}

func TestExportCSVWritePathError(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 2)
	}
	runtime.SetDEK(dek)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), runtime, testutil.NewTestLogger())
	_, err := svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "csv", Host: "1.1.1.1", Port: 22, Username: "u", AuthMethod: model.AuthPassword, Password: "p", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	parent := filepath.Join(t.TempDir(), "as-file")
	require.NoError(t, os.WriteFile(parent, []byte("x"), 0o600))
	_, err = svc.ExportCSV(filepath.Join(parent, "out.csv"), model.SessionCSVExportOptions{})
	assert.Error(t, err)
}

func TestAssetMutationInvalidInputs(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewAssetCatalogService(db, testutil.NewTestLogger())
	assert.Error(t, svc.DeleteEnvironment(model.AssetDeleteInput{ID: 1, Mode: "nope"}))
	_, err := svc.BulkSetEnvironment(model.BulkAssetAssignmentInput{SessionIDs: nil})
	assert.Error(t, err)
	_, err = svc.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: []int64{1}, TagIDs: []int64{-1}, Operation: "add"})
	assert.Error(t, err)
	assert.Error(t, svc.ReorderEnvironments([]int64{}))
	assert.Error(t, svc.ReorderProjects([]int64{1, 1}))
}

func TestSyncImportWithPasswordInstallerError(t *testing.T) {
	db := testutil.NewTestDB(t)
	vault, _, err := crypto.CreateVault("initial-pass-12")
	require.NoError(t, err)
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()),
		WithSyncSecretSource(func() (string, error) { return "secret-from-vault-xx", nil }),
		WithVaultInstaller(func(string, crypto.VaultFile) error { return assert.AnError }),
	)
	data, err := svc.snapshot()
	require.NoError(t, err)
	fp, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, "secret-from-vault-xx", syncArtifactMetadata{SnapshotFingerprint: fp, CreatedAt: time.Now().UTC()}, &vault)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "join.msshbackup")
	require.NoError(t, os.WriteFile(path, content, 0o600))
	assert.Error(t, svc.ImportWithPassword(path, "initial-pass-12"))
}

func TestSyncAdoptVaultNilVaultAndInstallerFail(t *testing.T) {
	db := testutil.NewTestDB(t)
	// content with artifact version but no vault field
	data := ExportData{FormatVersion: syncFormatVersion, Tables: map[string][]map[string]any{}}
	fp, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, "secret-from-vault-xx", syncArtifactMetadata{SnapshotFingerprint: fp, CreatedAt: time.Now().UTC()}, nil)
	require.NoError(t, err)
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()),
		WithVaultInstaller(func(string, crypto.VaultFile) error { return nil }),
	)
	assert.ErrorIs(t, svc.AdoptVaultFromContent("initial-pass-12", content), errSyncVaultMissing)
}

func TestSyncEnsureVersionDirectoryChmodPaths(t *testing.T) {
	// ensureVersionDirectory success already covered; force empty dataDir
	svc := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger(), WithSyncDataDir(""))
	assert.Error(t, svc.ensureVersionDirectory())
}

func TestKeyGenerateVariantsAlreadyCoveredExtraBits(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 11)
	}
	runtime.SetDEK(dek)
	svc := NewKeyService(db, runtime, testutil.NewTestLogger())
	// invalid RSA bits may error
	_, err := svc.Generate("rsa-bad", model.KeyTypeRSA, 1)
	assert.Error(t, err)
}

func TestSecurityEmitVaultStatusNilBus(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSecurityService(db, t.TempDir(), NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	status, err := svc.Status()
	require.NoError(t, err)
	svc.emitVaultStatus(status)
}

func TestWritePrivateFileAtomicOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file.bin")
	require.NoError(t, writePrivateFileAtomic(path, []byte("one")))
	require.NoError(t, writePrivateFileAtomic(path, []byte("two")))
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "two", string(content))
}
