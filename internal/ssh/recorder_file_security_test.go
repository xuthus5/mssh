package ssh

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCleanupFailedRecorderRemovesCreatedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "failed.msshlog")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	require.NoError(t, err)
	cause := errors.New("header failed")

	err = cleanupFailedRecorder(path, file, cause)

	require.ErrorIs(t, err, cause)
	_, statErr := os.Stat(path)
	assert.ErrorIs(t, statErr, os.ErrNotExist)
}

func TestNewRecorderRejectsExistingPathWithoutChangingIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing.msshlog")
	require.NoError(t, os.WriteFile(path, []byte("keep"), 0o600))

	recorder, err := NewRecorder(path, 80, 24, "xterm")

	if recorder != nil {
		_ = recorder.Close()
	}
	assert.Nil(t, recorder)
	require.Error(t, err)
	content, readErr := os.ReadFile(path)
	require.NoError(t, readErr)
	assert.Equal(t, "keep", string(content))
}

func TestNewRecorderRejectsSymlinkWithoutChangingTarget(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	directory := t.TempDir()
	target := filepath.Join(directory, "target")
	require.NoError(t, os.WriteFile(target, []byte("keep"), 0o600))
	link := filepath.Join(directory, "recording.msshlog")
	require.NoError(t, os.Symlink(target, link))

	recorder, err := NewRecorder(link, 80, 24, "xterm")

	if recorder != nil {
		_ = recorder.Close()
	}
	assert.Nil(t, recorder)
	require.Error(t, err)
	content, readErr := os.ReadFile(target)
	require.NoError(t, readErr)
	assert.Equal(t, "keep", string(content))
}
