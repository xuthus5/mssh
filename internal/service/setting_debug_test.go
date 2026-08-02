package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestApplicationDebugEnabledDefaultsToFalse(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())

	enabled, err := svc.ApplicationDebugEnabled()

	require.NoError(t, err)
	assert.False(t, enabled)
}

func TestApplicationDebugEnabledReadsPersistedValue(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: applicationDebugSetting, Namespace: "application", Value: "true", ValueType: "boolean", Version: 1,
	}}))

	enabled, err := svc.ApplicationDebugEnabled()

	require.NoError(t, err)
	assert.True(t, enabled)
}

func TestApplicationDebugEnabledRejectsMalformedValue(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: applicationDebugSetting, Namespace: "application", Value: `"not-a-bool"`, ValueType: "string", Version: 1,
	}}))

	_, err := svc.ApplicationDebugEnabled()

	require.Error(t, err)
}
