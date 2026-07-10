package event

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWailsEventBusEmitNoPanic(t *testing.T) {
	bus := NewWailsEventBus(nil)
	assert.NotPanics(t, func() {
		bus.Emit("test", "payload")
	})
}
