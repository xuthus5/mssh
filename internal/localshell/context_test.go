package localshell

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOpenContextRejectsCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := OpenContext(ctx, Options{})
	assert.ErrorIs(t, err, context.Canceled)
}

func TestOpenContextHandlesNilContext(t *testing.T) {
	_, err := OpenContext(nil, Options{Shell: t.TempDir() + "/missing-shell"})
	assert.Error(t, err)
}
