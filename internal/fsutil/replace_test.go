package fsutil

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReplaceFileReplacesExistingTarget(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "source")
	target := filepath.Join(directory, "target")
	require.NoError(t, os.WriteFile(source, []byte("new"), 0o600))
	require.NoError(t, os.WriteFile(target, []byte("old"), 0o600))

	require.NoError(t, ReplaceFile(source, target))
	content, err := os.ReadFile(target)
	require.NoError(t, err)
	require.Equal(t, []byte("new"), content)
	_, err = os.Stat(source)
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestReplaceFileReturnsSourceError(t *testing.T) {
	target := filepath.Join(t.TempDir(), "target")
	err := ReplaceFile(filepath.Join(t.TempDir(), "missing"), target)
	require.Error(t, err)
}
