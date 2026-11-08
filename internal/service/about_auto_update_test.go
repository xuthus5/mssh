package service

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/updater"

	"github.com/xuthus5/mssh/internal/model"
)

type fakeAutoUpdateSource struct {
	enabled bool
	err     error
	calls   atomic.Int32
}

func (source *fakeAutoUpdateSource) AutoUpdateEnabled() (bool, error) {
	source.calls.Add(1)
	return source.enabled, source.err
}

type fakeUpdateEngine struct {
	release     *updater.Release
	checkErr    error
	downloadErr error
	restartErr  error
	checks      atomic.Int32
	downloads   atomic.Int32
	restarts    atomic.Int32
}

func (engine *fakeUpdateEngine) Check(context.Context) (*updater.Release, error) {
	engine.checks.Add(1)
	return engine.release, engine.checkErr
}

func (engine *fakeUpdateEngine) DownloadAndInstall(context.Context) error {
	engine.downloads.Add(1)
	return engine.downloadErr
}

func (engine *fakeUpdateEngine) Restart(context.Context) error {
	engine.restarts.Add(1)
	return engine.restartErr
}

func newFakeRelease() *updater.Release {
	return &updater.Release{Version: "v0.2.0", Artifact: updater.Artifact{Filename: "mssh-0.2.0-windows-amd64.exe", Size: 128}}
}

func TestRunAutoUpdateDownloadsAndNotifies(t *testing.T) {
	release := newFakeRelease()
	engine := &fakeUpdateEngine{release: release}
	source := &fakeAutoUpdateSource{enabled: true}
	service := NewAboutService(WithAboutAutoUpdateSource(source))
	service.SetUpdater(engine)
	notified := make(chan model.UpdateInfo, 1)
	service.SetUpdateReadyHandler(func(info model.UpdateInfo) { notified <- info })

	service.runAutoUpdate(t.Context())

	require.Equal(t, int32(1), source.calls.Load())
	assert.Equal(t, int32(1), engine.checks.Load())
	assert.Equal(t, int32(1), engine.downloads.Load())
	info := <-notified
	assert.Equal(t, "v0.2.0", info.LatestVersion)
	assert.True(t, info.UpdateAvailable)
	assert.Equal(t, release.Artifact.Filename, info.ArtifactName)
	assert.Equal(t, release.Artifact.Size, info.ArtifactSize)
	assert.NotNil(t, service.ReadyUpdate())
}

func TestRunAutoUpdateSkipsWhenDisabledOrReady(t *testing.T) {
	engine := &fakeUpdateEngine{release: newFakeRelease()}
	source := &fakeAutoUpdateSource{enabled: false}
	service := NewAboutService(WithAboutAutoUpdateSource(source))
	service.SetUpdater(engine)

	service.runAutoUpdate(t.Context())
	assert.Zero(t, engine.checks.Load())

	source.enabled = true
	service.setReadyUpdate(model.UpdateInfo{LatestVersion: "v0.2.0", UpdateAvailable: true})
	service.runAutoUpdate(t.Context())
	assert.Zero(t, engine.checks.Load())
}

func TestRunAutoUpdateHandlesFailures(t *testing.T) {
	tests := []struct {
		name   string
		source *fakeAutoUpdateSource
		engine *fakeUpdateEngine
	}{
		{name: "missing source", engine: &fakeUpdateEngine{}},
		{name: "setting read error", source: &fakeAutoUpdateSource{enabled: true, err: errors.New("read failed")}, engine: &fakeUpdateEngine{}},
		{name: "missing updater", source: &fakeAutoUpdateSource{enabled: true}},
		{name: "check error", source: &fakeAutoUpdateSource{enabled: true}, engine: &fakeUpdateEngine{checkErr: errors.New("check failed")}},
		{name: "no update", source: &fakeAutoUpdateSource{enabled: true}, engine: &fakeUpdateEngine{}},
		{name: "download error", source: &fakeAutoUpdateSource{enabled: true}, engine: &fakeUpdateEngine{release: newFakeRelease(), downloadErr: errors.New("download failed")}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			options := []any{}
			if test.source != nil {
				options = append(options, WithAboutAutoUpdateSource(test.source))
			}
			service := NewAboutService(options...)
			if test.engine != nil {
				service.SetUpdater(test.engine)
			}
			service.runAutoUpdate(t.Context())
			assert.Nil(t, service.ReadyUpdate())
		})
	}
}

func TestRequestAutoUpdateCheckWakesWorker(t *testing.T) {
	service := NewAboutService()
	service.RequestAutoUpdateCheck()
	select {
	case <-service.autoUpdateWake:
	default:
		t.Fatal("automatic update worker was not woken")
	}
	service.RequestAutoUpdateCheck()
	service.RequestAutoUpdateCheck()
	assert.Len(t, service.autoUpdateWake, 1)
}

func TestAutoUpdateLoopConsumesWakeSignal(t *testing.T) {
	source := &fakeAutoUpdateSource{}
	service := NewAboutService(WithAboutAutoUpdateSource(source))
	service.autoUpdateEvery = time.Hour
	service.StartAutoUpdate()
	t.Cleanup(service.Shutdown)

	require.Eventually(t, func() bool {
		return source.calls.Load() >= 1
	}, time.Second, 10*time.Millisecond)

	service.RequestAutoUpdateCheck()

	require.Eventually(t, func() bool {
		return source.calls.Load() >= 2
	}, time.Second, 10*time.Millisecond)
}
