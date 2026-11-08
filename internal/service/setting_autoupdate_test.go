package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSettingServiceAutoUpdateEnabled(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewSettingService(database, testutil.NewTestLogger())

	enabled, err := service.AutoUpdateEnabled()
	require.NoError(t, err)
	assert.False(t, enabled)

	require.NoError(t, service.Set(model.SettingInput{
		Key: applicationAutoUpdateSetting, Namespace: "application", Value: "true", ValueType: "boolean", Version: 1,
	}))
	enabled, err = service.AutoUpdateEnabled()
	require.NoError(t, err)
	assert.True(t, enabled)
}

func TestSettingServiceAutoUpdateEnabledRejectsInvalidValue(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewSettingService(database, testutil.NewTestLogger())
	require.NoError(t, service.Set(model.SettingInput{
		Key: applicationAutoUpdateSetting, Namespace: "application", Value: `"invalid"`, ValueType: "string", Version: 1,
	}))
	_, err := service.AutoUpdateEnabled()
	require.ErrorContains(t, err, "decode automatic update setting")
}
