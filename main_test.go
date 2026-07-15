package main

import (
	"path/filepath"
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
	configureWindows(wailsApp)

	assert.False(t, wailsApp.Event.Emit(windowing.OpenSettingsWindowEvent))
	assert.Eventually(t, func() bool {
		settingsWindow, exists := wailsApp.Window.GetByName(windowing.SettingsWindowName)
		return exists && settingsWindow != nil
	}, time.Second, 10*time.Millisecond)
	assert.Len(t, wailsApp.Window.GetAll(), 2)

	assert.False(t, wailsApp.Event.Emit(windowing.OpenSettingsWindowEvent))
	assert.Eventually(t, func() bool { return len(wailsApp.Window.GetAll()) == 2 }, time.Second, 10*time.Millisecond)
}
