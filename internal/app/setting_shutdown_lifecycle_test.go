package app

import (
	"bytes"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
)

type blockingAppSettingLogConfigurer struct {
	started   chan struct{}
	release   chan struct{}
	startOnce sync.Once
}

func (configurer *blockingAppSettingLogConfigurer) Configure(string, int) error {
	configurer.startOnce.Do(func() { close(configurer.started) })
	<-configurer.release
	return nil
}

func (configurer *blockingAppSettingLogConfigurer) Dir() string { return "" }

func (configurer *blockingAppSettingLogConfigurer) RetentionDays() int { return 30 }

func TestAppShutdownWaitsForSettingsBeforeSecurityAndDatabase(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	logConfigurer := &blockingAppSettingLogConfigurer{
		started: make(chan struct{}), release: make(chan struct{}),
	}
	var releaseOnce sync.Once
	releaseLog := func() { releaseOnce.Do(func() { close(logConfigurer.release) }) }
	t.Cleanup(releaseLog)
	settingService := service.NewSettingService(database, DefaultTestLogger(t), logConfigurer)
	runtime := service.NewCryptoRuntime()
	runtime.SetDEK(bytes.Repeat([]byte{7}, 32))
	securityService := service.NewSecurityService(database, t.TempDir(), runtime, nil, DefaultTestLogger(t))
	logDir := t.TempDir()
	payload, err := json.Marshal(logDir)
	require.NoError(t, err)
	setDone := make(chan error, 1)
	go func() {
		setDone <- settingService.Set(model.SettingInputFrom(model.Setting{
			Key: "application.log_dir", Namespace: "application",
			Value: string(payload), ValueType: "string", Version: 1,
		}))
	}()
	<-logConfigurer.started

	shutdownDone := make(chan struct{})
	go func() {
		(&App{
			DB: database, Setting: settingService, Security: securityService, logger: DefaultTestLogger(t),
		}).Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("app shutdown returned before the active setting operation completed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, database.Ping())
	require.NoError(t, runtime.RequireUnlocked())

	releaseLog()
	require.NoError(t, <-setDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("app shutdown did not finish after the setting operation completed")
	}
	assert.Error(t, database.Ping())
	assert.ErrorIs(t, runtime.RequireUnlocked(), service.ErrVaultLocked)
	_, err = settingService.Get("application.language")
	require.ErrorContains(t, err, "setting service is shutting down")
}
