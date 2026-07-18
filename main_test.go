package main

import (
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/xuthus5/mssh/internal/windowing"
)

func TestMainWindowOptionsUseStableLinuxRendering(t *testing.T) {
	options := mainWindowOptions()

	assert.Equal(t, "main", options.Name)
	assert.Equal(t, 1280, options.Width)
	assert.Equal(t, 800, options.Height)
	assert.True(t, options.Frameless)
	assert.True(t, options.EnableFileDrop)
	assert.Equal(t, application.BackgroundTypeTranslucent, options.BackgroundType)
	assert.Equal(t, uint8(0), options.BackgroundColour.Alpha)
	assert.True(t, options.Linux.WindowIsTranslucent)
	assert.Equal(t, application.MacBackdropTransparent, options.Mac.Backdrop)
	assert.Equal(t, application.WebviewGpuPolicyNever, options.Linux.WebviewGpuPolicy)
}

func TestDefaultDataDirUsesUserHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	assert.Equal(t, filepath.Join(home, ".mssh"), defaultDataDir())
}

func TestConfigureWindowsCreatesAndReusesSettingsWindow(t *testing.T) {
	wailsApp := application.New(application.Options{Name: "mssh-window-test"})
	configureWindows(wailsApp, windowConfiguration{})

	settingsWindow, exists := wailsApp.Window.GetByName(windowing.SettingsWindowName)
	assert.True(t, exists)
	assert.NotNil(t, settingsWindow)
	assert.Len(t, wailsApp.Window.GetAll(), 2)

	assert.False(t, wailsApp.Event.Emit(windowing.OpenSettingsWindowEvent))
	assert.Eventually(t, func() bool {
		reused, found := wailsApp.Window.GetByName(windowing.SettingsWindowName)
		return found && reused == settingsWindow
	}, time.Second, 10*time.Millisecond)
	assert.Len(t, wailsApp.Window.GetAll(), 2)

	assert.False(t, wailsApp.Event.Emit(windowing.OpenSettingsWindowEvent))
	assert.Eventually(t, func() bool { return len(wailsApp.Window.GetAll()) == 2 }, time.Second, 10*time.Millisecond)
}

func TestEmbeddedApplicationIconIsPNG(t *testing.T) {
	assert.Greater(t, len(appIcon), 8)
	assert.Equal(t, []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, appIcon[:8])
}

func TestSystemTrayMenuContainsRequiredActions(t *testing.T) {
	wailsApp := application.New(application.Options{Name: "mssh-tray-test"})
	controller := windowing.NewApplicationLifecycleController(windowing.ApplicationLifecycleOptions{})
	_, menu := configureSystemTray(wailsApp, controller)

	assert.NotNil(t, menu.FindByLabel("显示主窗口"))
	assert.NotNil(t, menu.FindByLabel("隐藏到托盘"))
	assert.NotNil(t, menu.FindByLabel("退出"))
}

func TestWaitForWindowsClosedObservesAsynchronousCleanup(t *testing.T) {
	var count atomic.Int32
	count.Store(1)
	go func() {
		time.Sleep(10 * time.Millisecond)
		count.Store(0)
	}()

	assert.True(t, waitForWindowsClosed(func() int { return int(count.Load()) }, time.Second, time.Millisecond))
}

func TestWaitForWindowsClosedTimesOut(t *testing.T) {
	assert.False(t, waitForWindowsClosed(func() int { return 1 }, 5*time.Millisecond, time.Millisecond))
}
