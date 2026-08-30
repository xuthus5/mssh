package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestWebviewGpuDefaultsToNever(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())

	policy, err := svc.WebviewGpu()

	require.NoError(t, err)
	assert.Equal(t, "never", policy)
}

func TestWebviewGpuReadsPersistedAlways(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: webviewGpuSetting, Namespace: "application", Value: `"always"`, ValueType: "string", Version: 1,
	}}))

	policy, err := svc.WebviewGpu()

	require.NoError(t, err)
	assert.Equal(t, "always", policy)
}

func TestWebviewGpuNormalizesUnknownValueToNever(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: webviewGpuSetting, Namespace: "application", Value: `"ondemand"`, ValueType: "string", Version: 1,
	}}))

	policy, err := svc.WebviewGpu()

	require.NoError(t, err)
	assert.Equal(t, "never", policy)
}

func TestWebviewGpuRejectsMalformedValue(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: webviewGpuSetting, Namespace: "application", Value: "123", ValueType: "number", Version: 1,
	}}))

	_, err := svc.WebviewGpu()

	require.Error(t, err)
}
