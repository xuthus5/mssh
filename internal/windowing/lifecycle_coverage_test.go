package windowing

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewApplicationLifecycleControllerDefaultLogger(t *testing.T) {
	controller := NewApplicationLifecycleController(ApplicationLifecycleOptions{})
	assert.NotNil(t, controller)
	assert.NotNil(t, controller.options.Logger)
}
