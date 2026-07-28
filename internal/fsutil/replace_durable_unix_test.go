//go:build !windows

package fsutil

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExecuteReplaceFileSyncsTargetDirectory(t *testing.T) {
	target := filepath.Join(t.TempDir(), "target")
	replaced := false
	syncedPath := ""
	operation := replaceFileOperation{
		source: "source",
		target: target,
		replace: func(_, _ string) error {
			replaced = true
			return nil
		},
		syncDirectory: func(path string) error {
			syncedPath = path
			return nil
		},
	}

	err := executeReplaceFile(operation)

	require.NoError(t, err)
	assert.True(t, replaced)
	assert.Equal(t, filepath.Dir(target), syncedPath)
}

func TestExecuteReplaceFileReturnsDirectorySyncError(t *testing.T) {
	syncErr := errors.New("directory sync failed")
	target := filepath.Join(t.TempDir(), "target")
	replaced := false
	syncedPath := ""
	operation := replaceFileOperation{
		source: "source",
		target: target,
		replace: func(_, _ string) error {
			replaced = true
			return nil
		},
		syncDirectory: func(path string) error {
			syncedPath = path
			return syncErr
		},
	}

	err := executeReplaceFile(operation)

	require.Error(t, err)
	assert.ErrorIs(t, err, syncErr)
	assert.True(t, replaced)
	assert.Equal(t, filepath.Dir(target), syncedPath)
}

func TestExecuteReplaceFileSkipsDirectorySyncWhenReplaceFails(t *testing.T) {
	replaceErr := errors.New("replace failed")
	syncCalled := false
	operation := replaceFileOperation{
		source: "source",
		target: "target",
		replace: func(_, _ string) error {
			return replaceErr
		},
		syncDirectory: func(string) error {
			syncCalled = true
			return nil
		},
	}

	err := executeReplaceFile(operation)

	assert.ErrorIs(t, err, replaceErr)
	assert.False(t, syncCalled)
}

func TestSyncDirectoryFlushesExistingDirectory(t *testing.T) {
	require.NoError(t, syncDirectory(t.TempDir()))
}

func TestSyncDirectoryReturnsOpenError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing")

	err := syncDirectory(path)

	require.Error(t, err)
	assert.ErrorIs(t, err, os.ErrNotExist)
	assert.ErrorContains(t, err, "open directory")
}
