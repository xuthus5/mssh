package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSettingServiceTypedAPI(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	entry := model.Setting{Key: "appearance.color_mode", Namespace: "appearance", Value: `"dark"`, ValueType: "string", Version: 1}
	require.NoError(t, svc.Set(model.SettingInputFrom(entry)))
	loaded, err := svc.Get(entry.Key)
	require.NoError(t, err)
	require.NotNil(t, loaded)
	assert.Equal(t, entry.Value, loaded.Value)
	require.NoError(t, svc.Delete(entry.Key))
}

func TestSettingServiceTypedCollections(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	settings := []model.Setting{
		{Key: "appearance.color_mode", Namespace: "appearance", Value: `"dark"`, ValueType: "string", Version: 1},
		{Key: "appearance.font_size", Namespace: "appearance", Value: `14`, ValueType: "number", Version: 1},
	}
	inputs := []model.SettingInput{model.SettingInputFrom(settings[0]), model.SettingInputFrom(settings[1])}
	require.NoError(t, svc.SetMany(inputs))

	loaded, err := svc.GetMany([]string{settings[0].Key, settings[1].Key})
	require.NoError(t, err)
	assert.Len(t, loaded, 2)

	listed, err := svc.List("appearance")
	require.NoError(t, err)
	assert.Len(t, listed, 2)
}

func TestSettingServiceRejectsSecretKeys(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	err := svc.Set(model.SettingInputFrom(model.Setting{
		Key: "sync.master_key", Namespace: "sync", Value: `"secret"`, ValueType: "string", Version: 1,
	}))
	require.Error(t, err)
	_, err = svc.Get("sync.secret.gist_token")
	require.Error(t, err)
	_, err = svc.GetMany([]string{"appearance.color_mode", "sync.master_key"})
	require.Error(t, err)
	err = svc.Delete("sync.master_key")
	require.Error(t, err)
}
