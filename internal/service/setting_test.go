package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSettingServiceGetSet(t *testing.T) {
	db := testutil.NewTestDB(t)

	svc := NewSettingService(db, testutil.NewTestLogger())

	val, err := svc.GetSetting("test_key")
	require.NoError(t, err)
	assert.Empty(t, val)

	err = svc.SetSetting("test_key", "test_value")
	require.NoError(t, err)

	val, err = svc.GetSetting("test_key")
	require.NoError(t, err)
	assert.Equal(t, "test_value", val)
}

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
