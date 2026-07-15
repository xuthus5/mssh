package main

import (
	"bytes"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWailsSystemLoggerDropsSensitiveRuntimePayloads(t *testing.T) {
	var output bytes.Buffer
	base := slog.New(slog.NewTextHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug}))
	logger := newWailsSystemLogger(base)

	logger.Debug("Runtime diagnostic", "args", "PRIVATE-RUNTIME")
	logger.Info("Binding call complete:", "result", "PRIVATE-RESULT")
	logger.Info("Wails started")

	assert.NotContains(t, output.String(), "PRIVATE-RUNTIME")
	assert.NotContains(t, output.String(), "PRIVATE-RESULT")
	assert.Contains(t, output.String(), "Wails started")
}

func TestWailsKeyFilePickerRejectsMissingApplication(t *testing.T) {
	picker := &wailsKeyFilePicker{}
	_, err := picker.SelectPrivateKey(t.TempDir())
	assert.ErrorContains(t, err, "not initialized")
}
