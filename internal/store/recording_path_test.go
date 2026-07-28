package store

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateRecordingPathsAcceptsTrustedFilesAndMissingRoots(t *testing.T) {
	recordingsDir := t.TempDir()
	missingRecordingsDir := filepath.Join(t.TempDir(), "missing")
	existingPath := filepath.Join(recordingsDir, "existing.msshlog")
	require.NoError(t, os.WriteFile(existingPath, []byte("recording"), 0o600))

	tests := []struct {
		name      string
		paths     []string
		directory string
		wantError string
	}{
		{name: "empty list", directory: recordingsDir},
		{name: "existing file", paths: []string{existingPath}, directory: recordingsDir},
		{name: "missing file", paths: []string{filepath.Join(recordingsDir, "missing.msshlog")}, directory: recordingsDir},
		{
			name:      "missing root",
			paths:     []string{filepath.Join(missingRecordingsDir, "recording.msshlog")},
			directory: missingRecordingsDir,
		},
		{
			name:      "outside file",
			paths:     []string{filepath.Join(t.TempDir(), "outside.msshlog")},
			directory: recordingsDir,
			wantError: "outside recordings directory",
		},
		{
			name:      "empty path",
			paths:     []string{"  "},
			directory: recordingsDir,
			wantError: "recording path is empty",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateRecordingPaths(test.paths, test.directory)
			if test.wantError == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.ErrorContains(t, err, test.wantError)
		})
	}
}

func TestValidateRecordingPathsRejectsInvalidFilesystemEntries(t *testing.T) {
	recordingsDir := t.TempDir()
	directoryPath := filepath.Join(recordingsDir, "nested")
	require.NoError(t, os.Mkdir(directoryPath, 0o700))
	fileRoot := filepath.Join(t.TempDir(), "not-a-directory")
	require.NoError(t, os.WriteFile(fileRoot, []byte("root"), 0o600))

	assert.ErrorContains(t, validateRecordingPaths([]string{directoryPath}, recordingsDir), "recording path is a directory")
	assert.ErrorContains(t, validateRecordingPaths([]string{filepath.Join(recordingsDir, "absent", "missing.msshlog")}, recordingsDir), "resolve recording parent")
	assert.ErrorContains(t, validateRecordingPaths([]string{filepath.Join(recordingsDir, "missing.msshlog")}, fileRoot), "recording directory is not a real directory")
}

func TestValidateRecordingPathsHandlesSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	recordingsDir := t.TempDir()
	insidePath := filepath.Join(recordingsDir, "inside.msshlog")
	require.NoError(t, os.WriteFile(insidePath, []byte("inside"), 0o600))
	insideLink := filepath.Join(recordingsDir, "inside-link.msshlog")
	require.NoError(t, os.Symlink(insidePath, insideLink))
	assert.NoError(t, validateRecordingPaths([]string{insideLink}, recordingsDir))

	outsidePath := filepath.Join(t.TempDir(), "outside.msshlog")
	require.NoError(t, os.WriteFile(outsidePath, []byte("outside"), 0o600))
	outsideLink := filepath.Join(recordingsDir, "outside-link.msshlog")
	require.NoError(t, os.Symlink(outsidePath, outsideLink))
	assert.ErrorContains(t, validateRecordingPaths([]string{outsideLink}, recordingsDir), "outside recordings directory")

	rootLink := filepath.Join(t.TempDir(), "recordings-link")
	require.NoError(t, os.Symlink(recordingsDir, rootLink))
	assert.ErrorContains(t, validateRecordingPaths(nil, rootLink), "recording directory is not a real directory")
}

func TestRemoveRecordingFileIsIdempotentAndReportsFilesystemErrors(t *testing.T) {
	recordingsDir := t.TempDir()
	missingPath := filepath.Join(recordingsDir, "missing.msshlog")
	require.NoError(t, removeRecordingFile(missingPath))

	existingPath := filepath.Join(recordingsDir, "existing.msshlog")
	require.NoError(t, os.WriteFile(existingPath, []byte("recording"), 0o600))
	require.NoError(t, removeRecordingFile(existingPath))
	_, err := os.Stat(existingPath)
	assert.ErrorIs(t, err, os.ErrNotExist)

	directoryPath := filepath.Join(recordingsDir, "directory")
	require.NoError(t, os.Mkdir(directoryPath, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(directoryPath, "child"), []byte("child"), 0o600))
	assert.Error(t, removeRecordingFile(directoryPath))
}
