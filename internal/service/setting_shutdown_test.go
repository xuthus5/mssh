package service

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type blockingSettingLogConfigurer struct {
	mu        sync.Mutex
	started   chan struct{}
	release   chan struct{}
	startOnce sync.Once
	dir       string
	retention int
}

func newBlockingSettingLogConfigurer() *blockingSettingLogConfigurer {
	return &blockingSettingLogConfigurer{
		started: make(chan struct{}), release: make(chan struct{}), retention: 30,
	}
}

func (configurer *blockingSettingLogConfigurer) Configure(dir string, retention int) error {
	configurer.startOnce.Do(func() { close(configurer.started) })
	<-configurer.release
	configurer.mu.Lock()
	configurer.dir = dir
	configurer.retention = retention
	configurer.mu.Unlock()
	return nil
}

func (configurer *blockingSettingLogConfigurer) Dir() string {
	configurer.mu.Lock()
	defer configurer.mu.Unlock()
	return configurer.dir
}

func (configurer *blockingSettingLogConfigurer) RetentionDays() int {
	configurer.mu.Lock()
	defer configurer.mu.Unlock()
	return configurer.retention
}

func TestSettingServiceShutdownWaitsForRuntimeApply(t *testing.T) {
	database := testutil.NewTestDB(t)
	logConfigurer := newBlockingSettingLogConfigurer()
	service := NewSettingService(database, testutil.NewTestLogger(), logConfigurer)
	setting := testLogDirectorySetting(t, t.TempDir())
	setDone := make(chan error, 1)
	go func() { setDone <- service.Set(setting) }()
	<-logConfigurer.started

	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("setting shutdown returned before runtime apply completed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, database.Ping())

	close(logConfigurer.release)
	require.NoError(t, <-setDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("setting shutdown did not finish after runtime apply completed")
	}
	stored, err := store.GetSettingEntry(database, applicationLogDirSetting)
	require.NoError(t, err)
	require.NotNil(t, stored)
}

func TestSettingServiceRejectsAllOperationsAfterShutdown(t *testing.T) {
	service := NewSettingService(testutil.NewTestDB(t), testutil.NewTestLogger())
	service.Shutdown()

	_, err := service.Get("application.language")
	require.ErrorContains(t, err, "setting service is shutting down")
	_, err = service.GetMany([]string{"application.language"})
	require.ErrorContains(t, err, "setting service is shutting down")
	_, err = service.List("application")
	require.ErrorContains(t, err, "setting service is shutting down")
	err = service.Set(model.SettingInput{Key: "application.language"})
	require.ErrorContains(t, err, "setting service is shutting down")
	err = service.SetMany([]model.SettingInput{{Key: "application.language"}})
	require.ErrorContains(t, err, "setting service is shutting down")
	err = service.Delete("application.language")
	require.ErrorContains(t, err, "setting service is shutting down")
	require.ErrorContains(t, service.ApplyStoredLogSettings(), "setting service is shutting down")
	require.ErrorContains(t, service.ApplyStoredProxySettings(), "setting service is shutting down")
	service.Shutdown()
}

func TestNilSettingServiceShutdown(t *testing.T) {
	var service *SettingService
	assert.NotPanics(t, service.Shutdown)
	_, err := service.Get("application.language")
	require.ErrorContains(t, err, "setting service is shutting down")
}

func testLogDirectorySetting(t *testing.T, dir string) model.SettingInput {
	t.Helper()
	payload, err := json.Marshal(dir)
	require.NoError(t, err)
	return model.SettingInputFrom(model.Setting{
		Key: applicationLogDirSetting, Namespace: "application",
		Value: string(payload), ValueType: "string", Version: 1,
	})
}
