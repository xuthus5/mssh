package service

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/applog"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
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

func TestSettingServiceFiltersSecretsFromList(t *testing.T) {
	db := testutil.NewTestDB(t)
	// Direct store write of a blocked key should still be filtered by List/GetMany surface.
	require.NoError(t, store.SetSettings(db, []model.Setting{
		{Key: "sync.enabled", Namespace: "sync", Value: `true`, ValueType: "boolean", Version: 1},
		{Key: "sync.secret.gist_token", Namespace: "sync", Value: `"tok"`, ValueType: "string", Version: 1},
	}))
	svc := NewSettingService(db, testutil.NewTestLogger())
	listed, err := svc.List("sync")
	require.NoError(t, err)
	require.Len(t, listed, 1)
	assert.Equal(t, "sync.enabled", listed[0].Key)
	assert.True(t, settingBlocked("provider.token"))
	assert.True(t, settingBlocked("app.password"))
	assert.False(t, settingBlocked("appearance.color_mode"))
	assert.Nil(t, filterBlockedSettings(nil))
}

type stubLogConfigurer struct {
	dir       string
	retention int
	calls     int
	err       error
}

func (s *stubLogConfigurer) Configure(dir string, retentionDays int) error {
	s.calls++
	if s.err != nil {
		return s.err
	}
	s.dir = dir
	s.retention = retentionDays
	return nil
}

func (s *stubLogConfigurer) Dir() string {
	if s.dir == "" {
		return applog.DefaultDir()
	}
	return s.dir
}

func (s *stubLogConfigurer) RetentionDays() int {
	if s.retention == 0 {
		return applog.DefaultRetentionDays
	}
	return s.retention
}

func TestSettingServiceAppliesLogSettings(t *testing.T) {
	db := testutil.NewTestDB(t)
	log := &stubLogConfigurer{}
	svc := NewSettingService(db, testutil.NewTestLogger(), log)
	dir := t.TempDir()
	payload, err := json.Marshal(dir)
	require.NoError(t, err)
	require.NoError(t, svc.SetMany([]model.SettingInput{
		model.SettingInputFrom(model.Setting{Key: "application.log_dir", Namespace: "application", Value: string(payload), ValueType: "string", Version: 1}),
		model.SettingInputFrom(model.Setting{Key: "application.log_retention_days", Namespace: "application", Value: `14`, ValueType: "number", Version: 1}),
	}))
	assert.Equal(t, 1, log.calls)
	assert.Equal(t, dir, log.dir)
	assert.Equal(t, 14, log.retention)
	require.NoError(t, svc.ApplyStoredLogSettings())
	assert.GreaterOrEqual(t, log.calls, 2)
}
