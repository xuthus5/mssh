package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestMainWindowOptionsUseStableLinuxRendering(t *testing.T) {
	options := mainWindowOptions()

	assert.Equal(t, 1280, options.Width)
	assert.Equal(t, 800, options.Height)
	assert.True(t, options.Frameless)
	assert.Equal(t, application.WebviewGpuPolicyNever, options.Linux.WebviewGpuPolicy)
}
