package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSyncDownloadRollsBackDataWhenBaselineCommitFails(t *testing.T) {
	service, provider, baseline := newVersionValidationService(t)
	provider.remote = versionedRemoteArtifactForTest(t, "remote-change", syncArtifactMetadata{
		VersionID: "remote-child", VersionNumber: baseline.VersionNumber + 1, ParentVersionID: baseline.VersionID,
	})
	_, err := service.db.Exec(`CREATE TRIGGER fail_download_baseline BEFORE UPDATE ON settings
		WHEN OLD.key = 'sync.baseline.webdav' BEGIN SELECT RAISE(FAIL, 'forced baseline failure'); END`)
	require.NoError(t, err)

	_, err = service.SyncNow()
	require.ErrorContains(t, err, "forced baseline failure")
	assert.Equal(t, []string{"local"}, syncSessionNames(t, service.db))

	current, loadErr := service.loadBaseline(model.SyncProviderWebDAV)
	require.NoError(t, loadErr)
	assert.Equal(t, baseline, current)
}

func TestFinishSuccessfulSyncDoesNotFailAfterRetentionCleanupError(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey)
	oldVersion := insertSyncVersionForCommitTest(t, db, "old", "old-fingerprint")
	newVersion := insertSyncVersionForCommitTest(t, db, "new", "new-fingerprint")
	_, err := db.Exec(`CREATE TRIGGER fail_sync_version_delete BEFORE DELETE ON sync_versions
		BEGIN SELECT RAISE(FAIL, 'forced retention failure'); END`)
	require.NoError(t, err)

	config := defaultSyncConfig()
	config.Provider = model.SyncProviderWebDAV
	config.RetentionCount = 1
	config.RetentionDays = 1
	err = service.finishSuccessfulSync(syncCompletion{
		Config: config, Metadata: syncArtifactMetadata{
			VersionID: "new", VersionNumber: 2, ParentVersionID: "old", SnapshotFingerprint: "new-fingerprint",
			CreatedAt: time.Now().UTC(),
		},
		ETag: `"new"`, LocalVersionID: newVersion.ID,
	})
	require.NoError(t, err)

	baseline, loadErr := service.loadBaseline(model.SyncProviderWebDAV)
	require.NoError(t, loadErr)
	assert.Equal(t, "new", baseline.VersionID)
	assert.Equal(t, model.SyncStateSynced, service.state.State)
	retained, getErr := store.GetSyncVersion(db, oldVersion.ID)
	require.NoError(t, getErr)
	assert.NotNil(t, retained)
}
