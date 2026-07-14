package main

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestMainWindowOptionsUseStableLinuxRendering(t *testing.T) {
	options := mainWindowOptions()

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
