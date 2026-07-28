package service

import (
	"database/sql"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSyncEngineAcceptsImmediateRemoteDescendant(t *testing.T) {
	service, provider, baseline := newVersionValidationService(t)
	provider.remote = versionedRemoteArtifactForTest(t, "remote-child", syncArtifactMetadata{
		VersionID: "remote-child", VersionNumber: baseline.VersionNumber + 1, ParentVersionID: baseline.VersionID,
	})

	result, err := service.SyncNow()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	assert.Equal(t, []string{"remote-child"}, syncSessionNames(t, service.db))
}

func TestSyncEngineRejectsReplayedRemoteVersion(t *testing.T) {
	service, provider, _ := newVersionValidationService(t)
	replayed := provider.remote
	replayed.Content = append([]byte(nil), replayed.Content...)

	_, err := store.CreateSession(service.db, model.Session{
		Name: "local-change", Host: "127.0.0.2", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	_, err = service.PushNow()
	require.NoError(t, err)
	provider.remote = replayed

	_, err = service.SyncNow()
	assert.ErrorContains(t, err, "rollback")
	assert.ElementsMatch(t, []string{"local", "local-change"}, syncSessionNames(t, service.db))
}

func TestSyncEngineRejectsSameNumberFork(t *testing.T) {
	service, provider, baseline := newVersionValidationService(t)
	provider.remote = versionedRemoteArtifactForTest(t, "fork", syncArtifactMetadata{
		VersionID: "fork-version", VersionNumber: baseline.VersionNumber,
	})

	_, err := service.SyncNow()
	assert.ErrorContains(t, err, "fork")
	assert.Equal(t, []string{"local"}, syncSessionNames(t, service.db))
}

func TestSyncEngineRejectsInvalidRemoteParent(t *testing.T) {
	service, provider, baseline := newVersionValidationService(t)
	provider.remote = versionedRemoteArtifactForTest(t, "invalid-parent", syncArtifactMetadata{
		VersionID: "remote-child", VersionNumber: baseline.VersionNumber + 1, ParentVersionID: "other-parent",
	})

	_, err := service.SyncNow()
	assert.ErrorContains(t, err, "parent")
	assert.Equal(t, []string{"local"}, syncSessionNames(t, service.db))
}

func TestSyncEngineAcceptsRemoteVersionGapAfterOfflineCatchUp(t *testing.T) {
	service, provider, baseline := newVersionValidationService(t)
	provider.remote = versionedRemoteArtifactForTest(t, "version-gap", syncArtifactMetadata{
		VersionID: "remote-gap", VersionNumber: baseline.VersionNumber + 2, ParentVersionID: "remote-intermediate",
	})

	result, err := service.SyncNow()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	assert.Equal(t, []string{"version-gap"}, syncSessionNames(t, service.db))
}

func TestValidateRemoteArtifactMetadata(t *testing.T) {
	tests := []struct {
		name       string
		metadata   syncArtifactMetadata
		errorMatch string
	}{
		{
			name: "valid root",
			metadata: syncArtifactMetadata{
				VersionID: "root", VersionNumber: 1, SnapshotFingerprint: "fingerprint",
			},
		},
		{
			name: "valid child",
			metadata: syncArtifactMetadata{
				VersionID: "child", VersionNumber: 2, ParentVersionID: "root", SnapshotFingerprint: "fingerprint",
			},
		},
		{
			name: "missing version metadata",
			metadata: syncArtifactMetadata{
				VersionID: " ", VersionNumber: 1, SnapshotFingerprint: "fingerprint",
			},
			errorMatch: "metadata is incomplete",
		},
		{
			name: "invalid version number",
			metadata: syncArtifactMetadata{
				VersionID: "version", VersionNumber: 0, SnapshotFingerprint: "fingerprint",
			},
			errorMatch: "metadata is incomplete",
		},
		{
			name: "missing fingerprint",
			metadata: syncArtifactMetadata{
				VersionID: "version", VersionNumber: 1,
			},
			errorMatch: "metadata is incomplete",
		},
		{
			name: "root has parent",
			metadata: syncArtifactMetadata{
				VersionID: "root", VersionNumber: 1, ParentVersionID: "parent", SnapshotFingerprint: "fingerprint",
			},
			errorMatch: "root version parent is invalid",
		},
		{
			name: "child has no parent",
			metadata: syncArtifactMetadata{
				VersionID: "child", VersionNumber: 2, ParentVersionID: " ", SnapshotFingerprint: "fingerprint",
			},
			errorMatch: "version parent is missing",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateRemoteArtifactMetadata(test.metadata)
			if test.errorMatch == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.ErrorContains(t, err, test.errorMatch)
		})
	}
}

func newVersionValidationService(t *testing.T) (*SyncService, *fakeSyncProvider, syncBaseline) {
	t.Helper()
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	_, err := store.CreateSession(db, model.Session{
		Name: "local", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	provider := &fakeSyncProvider{}
	service := newTestSyncService(db, syncTestMasterKey,
		WithSyncDataDir(t.TempDir()),
		WithSyncProviderFactory(fakeSyncProviderFactory{provider}),
	)
	_, err = service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)
	_, err = service.PushNow()
	require.NoError(t, err)
	baseline, err := service.loadBaseline(model.SyncProviderWebDAV)
	require.NoError(t, err)
	require.NotEmpty(t, baseline.VersionID)
	return service, provider, baseline
}

func versionedRemoteArtifactForTest(t *testing.T, sessionName string, metadata syncArtifactMetadata) syncRemoteObject {
	t.Helper()
	db := testutil.NewTestDB(t)
	_, err := store.CreateSession(db, model.Session{
		Name: sessionName, Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	metadata.SnapshotFingerprint, err = snapshotFingerprint(data)
	require.NoError(t, err)
	metadata.CreatedAt = time.Now().UTC()
	content, err := encodeSyncArtifact(data, syncTestMasterKey, metadata, nil)
	require.NoError(t, err)
	return syncRemoteObject{Content: content, ETag: `"remote"`}
}

func TestFinishSuccessfulSyncRollsBackProtectionWhenBaselineWriteFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey)
	oldVersion := insertSyncVersionForCommitTest(t, db, "old", "old-fingerprint")
	newVersion := insertSyncVersionForCommitTest(t, db, "new", "new-fingerprint")
	require.NoError(t, store.SetSyncVersionProtected(db, oldVersion.ID, true))
	previous := syncBaseline{
		VersionID: "old", VersionNumber: 1, SnapshotFingerprint: "old-fingerprint",
		ETag: `"old"`, LocalVersionID: oldVersion.ID, SyncedAt: time.Now().UTC(),
	}
	require.NoError(t, service.saveBaseline(model.SyncProviderWebDAV, previous))
	_, err := db.Exec(`CREATE TRIGGER fail_sync_baseline_update BEFORE UPDATE ON settings
		WHEN OLD.key = 'sync.baseline.webdav' BEGIN SELECT RAISE(FAIL, 'forced baseline failure'); END`)
	require.NoError(t, err)

	config := defaultSyncConfig()
	config.Provider = model.SyncProviderWebDAV
	err = service.finishSuccessfulSync(syncCompletion{
		Config: config, Metadata: syncArtifactMetadata{
			VersionID: "new", VersionNumber: 2, ParentVersionID: "old", SnapshotFingerprint: "new-fingerprint",
		},
		ETag: `"new"`, LocalVersionID: newVersion.ID,
	})
	require.ErrorContains(t, err, "forced baseline failure")

	oldAfter, err := store.GetSyncVersion(db, oldVersion.ID)
	require.NoError(t, err)
	newAfter, err := store.GetSyncVersion(db, newVersion.ID)
	require.NoError(t, err)
	require.NotNil(t, oldAfter)
	require.NotNil(t, newAfter)
	assert.True(t, oldAfter.Protected)
	assert.False(t, newAfter.Protected)
	baseline, err := service.loadBaseline(model.SyncProviderWebDAV)
	require.NoError(t, err)
	assert.Equal(t, previous, baseline)
}

func insertSyncVersionForCommitTest(t *testing.T, db *sql.DB, versionID, fingerprint string) model.SyncVersion {
	t.Helper()
	version, err := store.InsertSyncVersion(db, model.SyncVersion{
		VersionID: versionID, VersionNumber: 1, SnapshotFingerprint: fingerprint,
		Provider: model.SyncProviderWebDAV, Source: "test", FileName: versionID + ".msshbackup", CreatedAt: time.Now().UTC(),
	})
	require.NoError(t, err)
	return version
}
