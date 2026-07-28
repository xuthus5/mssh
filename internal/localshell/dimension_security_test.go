package localshell

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveOptionsRejectsDimensionsBeyondPTYRange(t *testing.T) {
	shell := defaultShell()
	require.NotEmpty(t, shell)

	_, err := resolveOptions(Options{Shell: shell, Cols: 1 << 16, Rows: 24})

	require.Error(t, err)
	assert.ErrorContains(t, err, "cols")
}

func TestSessionResizeRejectsDimensionsBeyondPTYRange(t *testing.T) {
	called := false
	session := &Session{resizeFn: func(int, int) error {
		called = true
		return nil
	}}

	err := session.Resize(1<<16, 24)

	require.Error(t, err)
	assert.False(t, called)
}

func TestResolveOptionsRejectsRowsBeyondPTYRange(t *testing.T) {
	shell := defaultShell()
	require.NotEmpty(t, shell)

	_, err := resolveOptions(Options{Shell: shell, Cols: 80, Rows: 1 << 16})

	require.Error(t, err)
	assert.ErrorContains(t, err, "rows")
}
