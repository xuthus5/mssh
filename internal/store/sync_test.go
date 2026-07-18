package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSyncVersionStoreLifecycle(t *testing.T) {
	db := setupTestDB(t)
	createdAt := time.Date(2026, 7, 18, 1, 2, 3, 4, time.UTC)
	version, err := InsertSyncVersion(db, model.SyncVersion{
		VersionID: "version-1", VersionNumber: 7, ParentVersionID: "version-0", SnapshotFingerprint: "fingerprint",
		Provider: model.SyncProviderGist, Source: "upload", FileName: "version.msshbackup", SizeBytes: 42, CreatedAt: createdAt,
	})
	require.NoError(t, err)
	assert.Positive(t, version.ID)

	found, err := FindSyncVersionByFingerprint(db, "fingerprint")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, version.ID, found.ID)
	assert.Equal(t, createdAt, found.CreatedAt)

	require.NoError(t, SetSyncVersionProtected(db, version.ID, true))
	require.NoError(t, DeleteSyncVersion(db, version.ID))
	versions, err := ListSyncVersions(db, 10)
	require.NoError(t, err)
	require.Len(t, versions, 1)
	assert.True(t, versions[0].Protected)

	require.NoError(t, SetSyncVersionProtected(db, version.ID, false))
	require.NoError(t, DeleteSyncVersion(db, version.ID))
	missing, err := GetSyncVersion(db, version.ID)
	require.NoError(t, err)
	assert.Nil(t, missing)
}

func TestSyncEventStoreOrdersNewestFirst(t *testing.T) {
	db := setupTestDB(t)
	for _, action := range []string{"first", "second"} {
		_, err := InsertSyncEvent(db, model.SyncEvent{
			Action: action, Provider: model.SyncProviderWebDAV, Strategy: model.SyncStrategySmart,
			Status: model.SyncEventSuccess, Message: action, CreatedAt: time.Now().UTC(),
		})
		require.NoError(t, err)
	}
	events, err := ListSyncEvents(db, 10)
	require.NoError(t, err)
	require.Len(t, events, 2)
	assert.Equal(t, "second", events[0].Action)
}
