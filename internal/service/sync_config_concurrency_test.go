package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSaveGistIDPreservesConcurrentConfigChanges(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	initial := gistConfigInput("")
	_, err := service.SaveConfig(initial)
	require.NoError(t, err)
	stale, err := service.LoadConfig()
	require.NoError(t, err)

	changed := initial
	changed.Strategy = model.SyncStrategyCloudFirst
	changed.RetentionCount = 45
	_, err = service.SaveConfig(changed)
	require.NoError(t, err)
	require.NoError(t, service.saveGistID(stale, "created-gist"))

	current, err := service.LoadConfig()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStrategyCloudFirst, current.Strategy)
	assert.Equal(t, 45, current.RetentionCount)
	assert.Equal(t, "created-gist", current.Gist.GistID)
}

func TestSaveGistIDRejectsChangedProviderIdentity(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	initial := gistConfigInput("")
	_, err := service.SaveConfig(initial)
	require.NoError(t, err)
	stale, err := service.LoadConfig()
	require.NoError(t, err)

	changed := initial
	changed.Gist.GistID = "manual-gist"
	_, err = service.SaveConfig(changed)
	require.NoError(t, err)
	err = service.saveGistID(stale, "created-gist")
	require.ErrorContains(t, err, "configuration changed")

	current, loadErr := service.LoadConfig()
	require.NoError(t, loadErr)
	assert.Equal(t, "manual-gist", current.Gist.GistID)
}

func gistConfigInput(gistID string) model.SyncConfigInput {
	return model.SyncConfigInput{
		Enabled: true, Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart,
		IntervalMinutes: 0, RetentionCount: 30, RetentionDays: 90,
		Gist: model.GistSyncConfigInput{GistID: gistID},
	}
}
