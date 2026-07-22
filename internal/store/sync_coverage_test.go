package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSyncEventStoreLifecycle(t *testing.T) {
	db := setupTestDB(t)
	createdAt := time.Date(2026, 7, 18, 4, 5, 6, 0, time.UTC)
	event, err := InsertSyncEvent(db, model.SyncEvent{
		Action: "upload", Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart,
		Status: model.SyncEventSuccess, LocalVersion: 1, RemoteVersion: 2, Message: "ok", CreatedAt: createdAt,
	})
	require.NoError(t, err)
	assert.Positive(t, event.ID)

	events, err := ListSyncEvents(db, 0)
	require.NoError(t, err)
	require.NotEmpty(t, events)
	assert.Equal(t, "upload", events[0].Action)

	// missing get
	missing, err := GetSyncVersion(db, 999999)
	require.NoError(t, err)
	assert.Nil(t, missing)
	missingFP, err := FindSyncVersionByFingerprint(db, "nope")
	require.NoError(t, err)
	assert.Nil(t, missingFP)
}
