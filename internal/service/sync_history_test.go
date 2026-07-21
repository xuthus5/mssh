package service

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSyncHistoryDeduplicatesAndRestoresVersion(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	created, err := store.CreateSession(db, model.Session{Name: "before", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	lifecycle := &fakeSyncLifecycle{}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()), WithSyncLifecycle(lifecycle))
	first, err := service.saveCurrentVersion(model.SyncProviderGist, "manual", false)
	require.NoError(t, err)
	second, err := service.saveCurrentVersion(model.SyncProviderGist, "manual", false)
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	info, err := os.Stat(service.versionFilePath(*first))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())

	require.NoError(t, store.DeleteSession(db, created.ID))
	require.NoError(t, service.RestoreVersion(first.ID))
	assert.Equal(t, 1, lifecycle.calls)
	restored, err := store.ListSessions(db, nil)
	require.NoError(t, err)
	require.Len(t, restored, 1)
	assert.Equal(t, "before", restored[0].Name)
}

func TestSyncRetentionDeletesOldUnprotectedVersions(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	require.NoError(t, service.ensureVersionDirectory())
	for index := 0; index < 3; index++ {
		fileName := time.Now().AddDate(0, 0, -index-2).Format("20060102") + string(rune('a'+index)) + syncBackupFileName
		require.NoError(t, os.WriteFile(syncVersionPath(service.dataDir, fileName), []byte("backup"), 0o600))
		_, err := store.InsertSyncVersion(db, model.SyncVersion{
			VersionID: fileName, SnapshotFingerprint: fileName, Provider: model.SyncProviderGist, Source: "test",
			FileName: fileName, SizeBytes: 6, Protected: index == 2, CreatedAt: time.Now().AddDate(0, 0, -index-2),
		})
		require.NoError(t, err)
	}
	require.NoError(t, service.applyRetention(model.SyncConfig{RetentionCount: 1, RetentionDays: 1}))
	versions, err := service.ListVersions()
	require.NoError(t, err)
	require.Len(t, versions, 1)
	assert.True(t, versions[0].Protected)
}
