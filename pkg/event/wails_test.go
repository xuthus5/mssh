package event

import (
	"bytes"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestWailsEventBusEmitNoPanic(t *testing.T) {
	bus := NewWailsEventBus(nil)
	assert.NotPanics(t, func() {
		bus.Emit("test", "payload")
	})
}

func TestWailsEventBusEmitWithLogger(t *testing.T) {
	bus := NewWailsEventBus(slog.Default())
	assert.NotPanics(t, func() {
		bus.Emit("test:event", "payload")
	})
}

func TestWailsEventBusEmitAfterAppStarted(t *testing.T) {
	app := application.New(application.Options{
		Name: "test-app",
	})
	defer app.Quit()

	bus := NewWailsEventBus(slog.Default())
	assert.NotPanics(t, func() {
		bus.Emit("test:event", map[string]string{"key": "value"})
	})
}

func TestWailsEventBusSuppressesTerminalOutputLog(t *testing.T) {
	app := application.New(application.Options{Name: "test-terminal-output-log"})
	defer app.Quit()
	var output bytes.Buffer
	bus := NewWailsEventBus(slog.New(slog.NewTextHandler(&output, nil)))

	bus.Emit(TerminalOutput, TerminalOutputPayload{TerminalID: "term-1", Data: []byte("output")})
	assert.NotContains(t, output.String(), "emitting event")

	bus.Emit("test:event", "payload")
	assert.Contains(t, output.String(), "emitting event")
	assert.Contains(t, output.String(), "test:event")
}

func TestNewWailsEventBus(t *testing.T) {
	bus := NewWailsEventBus(slog.Default())
	assert.NotNil(t, bus)
}
