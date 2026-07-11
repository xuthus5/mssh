package event

import (
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

func TestNewWailsEventBus(t *testing.T) {
	bus := NewWailsEventBus(slog.Default())
	assert.NotNil(t, bus)
}
