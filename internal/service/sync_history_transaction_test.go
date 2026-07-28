package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestDeleteVersionKeepsRecordWhenVersionPathIsNotRegular(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	require.NoError(t, service.ensureVersionDirectory())
	version, err := store.InsertSyncVersion(db, model.SyncVersion{
		VersionID: "damaged", VersionNumber: 1, SnapshotFingerprint: "damaged-fingerprint",
		Provider: model.SyncProviderGist, Source: "test", FileName: "damaged.msshbackup", CreatedAt: time.Now().UTC(),
	})
	require.NoError(t, err)
	path := service.versionFilePath(version)
	require.NoError(t, os.Mkdir(path, 0o700))
	require.NoError(t, os.WriteFile(path+"/unexpected", []byte("data"), 0o600))

	err = service.DeleteVersion(version.ID)
	require.ErrorContains(t, err, "regular file")
	retained, getErr := store.GetSyncVersion(db, version.ID)
	require.NoError(t, getErr)
	assert.NotNil(t, retained)
	info, statErr := os.Stat(path)
	require.NoError(t, statErr)
	assert.True(t, info.IsDir())
}

func TestDeleteVersionRestoresFileWhenDatabaseDeleteFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	require.NoError(t, service.ensureVersionDirectory())
	version, err := store.InsertSyncVersion(db, model.SyncVersion{
		VersionID: "retained", VersionNumber: 1, SnapshotFingerprint: "retained-fingerprint",
		Provider: model.SyncProviderGist, Source: "test", FileName: "retained.msshbackup", CreatedAt: time.Now().UTC(),
	})
	require.NoError(t, err)
	path := service.versionFilePath(version)
	require.NoError(t, os.WriteFile(path, []byte("content"), 0o600))
	_, err = db.Exec(`CREATE TRIGGER fail_version_delete BEFORE DELETE ON sync_versions
		BEGIN SELECT RAISE(FAIL, 'forced version delete failure'); END`)
	require.NoError(t, err)

	err = service.DeleteVersion(version.ID)
	require.ErrorContains(t, err, "forced version delete failure")
	content, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	assert.Equal(t, []byte("content"), content)
	retained, getErr := store.GetSyncVersion(db, version.ID)
	require.NoError(t, getErr)
	assert.NotNil(t, retained)
	staged, globErr := filepath.Glob(path + ".deleting-*")
	require.NoError(t, globErr)
	assert.Empty(t, staged)
}

func TestSaveVersionRebuildsMissingDeduplicatedFile(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	created, err := store.CreateSession(db, model.Session{
		Name: "recoverable", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthAgent, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	first, err := service.saveCurrentVersion(model.SyncProviderGist, "test", false)
	require.NoError(t, err)
	require.NoError(t, os.Remove(service.versionFilePath(*first)))

	second, err := service.saveCurrentVersion(model.SyncProviderGist, "test", false)
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	info, statErr := os.Stat(service.versionFilePath(*second))
	require.NoError(t, statErr)
	assert.True(t, info.Mode().IsRegular())

	require.NoError(t, store.DeleteSession(db, created.ID))
	require.NoError(t, service.RestoreVersion(second.ID))
	assert.Equal(t, []string{"recoverable"}, syncSessionNames(t, db))
}

func TestSaveVersionRepairsCorruptedDeduplicatedFile(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	created, err := store.CreateSession(db, model.Session{
		Name: "repairable", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthAgent, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	first, err := service.saveCurrentVersion(model.SyncProviderGist, "test", false)
	require.NoError(t, err)
	path := service.versionFilePath(*first)
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	var artifact syncArtifact
	require.NoError(t, json.Unmarshal(content, &artifact))
	ciphertext := []byte(artifact.Backup.Ciphertext)
	require.NotEmpty(t, ciphertext)
	if ciphertext[0] == 'A' {
		ciphertext[0] = 'B'
	} else {
		ciphertext[0] = 'A'
	}
	artifact.Backup.Ciphertext = string(ciphertext)
	damaged, err := json.MarshalIndent(artifact, "", "  ")
	require.NoError(t, err)
	damaged = append(damaged, '\n')
	require.NoError(t, os.WriteFile(path, damaged, 0o600))
	require.NoError(t, os.Chmod(path, 0o644))
	_, err = db.Exec("UPDATE sync_versions SET size_bytes = 1 WHERE id = ?", first.ID)
	require.NoError(t, err)

	second, err := service.saveCurrentVersion(model.SyncProviderGist, "test", false)
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	repaired, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.NotEqual(t, damaged, repaired)
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	stored, err := store.GetSyncVersion(db, first.ID)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, int64(len(repaired)), stored.SizeBytes)

	require.NoError(t, store.DeleteSession(db, created.ID))
	require.NoError(t, service.RestoreVersion(second.ID))
	assert.Equal(t, []string{"repairable"}, syncSessionNames(t, db))
}

func TestSaveVersionRepairsOversizedDeduplicatedFile(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	first, err := service.saveCurrentVersion(model.SyncProviderGist, "test", false)
	require.NoError(t, err)
	path := service.versionFilePath(*first)
	require.NoError(t, os.Truncate(path, maxCloudBackupSize+1))

	second, err := service.saveCurrentVersion(model.SyncProviderGist, "test", false)

	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.LessOrEqual(t, info.Size(), int64(maxCloudBackupSize))
	assert.Equal(t, info.Size(), second.SizeBytes)
}

func TestSaveVersionRejectsNonRegularDeduplicatedFile(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	first, err := service.saveCurrentVersion(model.SyncProviderGist, "test", false)
	require.NoError(t, err)
	path := service.versionFilePath(*first)
	require.NoError(t, os.Remove(path))
	require.NoError(t, os.Mkdir(path, 0o700))

	_, err = service.saveCurrentVersion(model.SyncProviderGist, "test", false)

	assert.ErrorContains(t, err, "regular file")
}

func TestReuseVersionReturnsProtectionUpdateError(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	require.NoError(t, service.ensureVersionDirectory())
	content := []byte("existing")
	version := &model.SyncVersion{
		ID: 1, FileName: "existing.msshbackup", SnapshotFingerprint: "existing", SizeBytes: int64(len(content)),
	}
	require.NoError(t, os.WriteFile(service.versionFilePath(*version), content, 0o600))
	require.NoError(t, db.Close())

	_, err := service.reuseVersion(version, content, true)

	assert.ErrorContains(t, err, "protect sync version")
}

func TestEnsureVersionFileReturnsSizeUpdateError(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	require.NoError(t, service.ensureVersionDirectory())
	content := []byte("existing")
	version := &model.SyncVersion{ID: 1, FileName: "existing.msshbackup", SizeBytes: 1}
	require.NoError(t, os.WriteFile(service.versionFilePath(*version), content, 0o600))
	require.NoError(t, db.Close())

	err := service.ensureVersionFile(version, content)

	assert.ErrorContains(t, err, "update sync version size")
}
