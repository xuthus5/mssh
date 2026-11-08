package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestDownloadUpdateStagesReleaseAndReusesReadyUpdate(t *testing.T) {
	engine := &fakeUpdateEngine{release: newFakeRelease()}
	service := NewAboutService()
	service.SetUpdater(engine)
	var notified int
	service.SetUpdateReadyHandler(func(_ model.UpdateInfo) { notified++ })

	first, err := service.DownloadUpdate(t.Context())
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.True(t, first.UpdateAvailable)
	assert.Equal(t, "v0.2.0", first.LatestVersion)
	assert.Equal(t, int32(1), engine.downloads.Load())
	assert.Equal(t, 1, notified)

	second, err := service.DownloadUpdate(t.Context())
	require.NoError(t, err)
	assert.Equal(t, first, second)
	assert.Equal(t, int32(1), engine.checks.Load())
	assert.Equal(t, int32(1), engine.downloads.Load())
}

func TestDownloadUpdateWithoutUpdaterOrRelease(t *testing.T) {
	service := NewAboutService()
	_, err := service.DownloadUpdate(t.Context())
	require.ErrorContains(t, err, "updater is not configured")

	service.SetUpdater(&fakeUpdateEngine{})
	info, err := service.DownloadUpdate(t.Context())
	require.NoError(t, err)
	require.NotNil(t, info)
	assert.False(t, info.UpdateAvailable)
}

func TestDownloadUpdateReportsEngineErrors(t *testing.T) {
	engine := &fakeUpdateEngine{checkErr: errors.New("check failed")}
	service := NewAboutService()
	service.SetUpdater(engine)
	_, err := service.DownloadUpdate(t.Context())
	require.ErrorContains(t, err, "check failed")

	engine = &fakeUpdateEngine{release: newFakeRelease(), downloadErr: errors.New("download failed")}
	service = NewAboutService()
	service.SetUpdater(engine)
	_, err = service.DownloadUpdate(t.Context())
	require.ErrorContains(t, err, "download failed")
}

func TestRestartUpdateValidation(t *testing.T) {
	service := NewAboutService()
	require.ErrorContains(t, service.RestartUpdate(t.Context()), "not configured")
	service.SetUpdater(&fakeUpdateEngine{})
	require.ErrorContains(t, service.RestartUpdate(nil), "context is required")
	require.NoError(t, service.RestartUpdate(context.Background()))
}
