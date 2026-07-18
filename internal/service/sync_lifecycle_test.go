package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestResetLocalDataPreservesSettingsAndCreatesRecoveryPoint(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	_, err := store.CreateSession(db, model.Session{Name: "reset-me", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	require.NoError(t, store.SetSettings(db, []model.Setting{{Key: "appearance.mode", Namespace: "appearance", Value: `"dark"`, ValueType: "string", Version: 1}}))
	lifecycle := &fakeSyncLifecycle{}
	eventBus := &fakeSyncEventBus{}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncLifecycle(lifecycle), WithSyncEventBus(eventBus))
	require.NoError(t, service.ResetLocalData())

	assert.Equal(t, 1, lifecycle.calls)
	assert.Equal(t, syncDataChangedEvent, eventBus.name)
	assert.Empty(t, syncSessionNames(t, db))
	setting, err := store.GetSettingEntry(db, "appearance.mode")
	require.NoError(t, err)
	require.NotNil(t, setting)
	versions, err := service.ListVersions()
	require.NoError(t, err)
	require.Len(t, versions, 1)
	assert.True(t, versions[0].Protected)
	events, err := service.ListEvents()
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, "reset", events[0].Action)
}
