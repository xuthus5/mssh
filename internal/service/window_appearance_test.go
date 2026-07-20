package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestWindowAppearanceServiceDefaultsToInactive(t *testing.T) {
	service := NewWindowAppearanceService(NewSettingService(testutil.NewTestDB(t), testutil.NewTestLogger()), testutil.NewTestLogger())

	status := service.GetStatus()

	assert.False(t, status.Active)
	assert.True(t, status.RequiresRestart)
	assert.NotEmpty(t, status.Platform)
}

func TestWindowAppearanceServiceReadsRequestedSetting(t *testing.T) {
	db := testutil.NewTestDB(t)
	settings := NewSettingService(db, testutil.NewTestLogger())
	require.NoError(t, settings.Set(model.SettingInput{Key: nativeTransparencySettingKey, Namespace: "appearance", Value: "true", ValueType: "boolean", Version: 1}))

	service := NewWindowAppearanceService(settings, testutil.NewTestLogger())

	assert.True(t, service.GetStatus().RequiresRestart)
	assert.Equal(t, service.GetStatus().Supported, service.NativeTransparencyActive())
}

func TestWindowAppearanceServiceIgnoresInvalidRequestedSetting(t *testing.T) {
	db := testutil.NewTestDB(t)
	settings := NewSettingService(db, testutil.NewTestLogger())
	require.NoError(t, settings.Set(model.SettingInput{Key: nativeTransparencySettingKey, Namespace: "appearance", Value: `"enabled"`, ValueType: "string", Version: 1}))

	service := NewWindowAppearanceService(settings, nil)

	assert.False(t, service.NativeTransparencyActive())
}
