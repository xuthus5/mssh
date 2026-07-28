package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestStageRecordingFileHandlesMissingAndNonRegularPaths(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing.msshlog")
	staged, err := stageRecordingFile(missing)
	require.NoError(t, err)
	assert.False(t, staged.exists)
	assert.Equal(t, missing, staged.originalPath)

	directory := filepath.Join(t.TempDir(), "recording.msshlog")
	require.NoError(t, os.Mkdir(directory, 0o700))
	_, err = stageRecordingFile(directory)
	assert.ErrorContains(t, err, "regular file")
}

func TestStagedRecordingFileRemoveHandlesNoopAndMissingFile(t *testing.T) {
	assert.NoError(t, (stagedRecordingFile{}).remove(nil))
	err := (stagedRecordingFile{exists: true}).remove(nil)
	assert.ErrorContains(t, err, "remover")
	err = (stagedRecordingFile{exists: true, stagedPath: "missing"}).remove(func(string) error { return os.ErrNotExist })
	assert.NoError(t, err)
}

func TestRecordingDirectoryPathsRejectsUnavailableAndInvalidDirectories(t *testing.T) {
	service := NewLogService(testutil.NewTestDB(t), "", testutil.NewTestLogger())
	_, _, err := service.recordingDirectoryPaths()
	assert.ErrorContains(t, err, "unavailable")

	dataDir := t.TempDir()
	service = NewLogService(testutil.NewTestDB(t), dataDir, testutil.NewTestLogger())
	_, _, err = service.recordingDirectoryPaths()
	assert.ErrorIs(t, err, os.ErrNotExist)

	recordingsPath := filepath.Join(dataDir, "recordings")
	require.NoError(t, os.WriteFile(recordingsPath, []byte("not a directory"), 0o600))
	_, _, err = service.recordingDirectoryPaths()
	assert.ErrorContains(t, err, "regular directory")
}

func TestCleanupStagedRecordingFileKeepsUncertainObjects(t *testing.T) {
	dataDir := t.TempDir()
	recordingsDir := filepath.Join(dataDir, "recordings")
	require.NoError(t, os.MkdirAll(recordingsDir, 0o700))
	service := NewLogService(testutil.NewTestDB(t), dataDir, testutil.NewTestLogger())

	service.cleanupStagedRecordingFile(filepath.Join(recordingsDir, "missing.deleting-test"))
	directory := filepath.Join(recordingsDir, "directory.deleting-test")
	require.NoError(t, os.Mkdir(directory, 0o700))
	service.cleanupStagedRecordingFile(directory)
	invalidName := filepath.Join(recordingsDir, "recording.msshlog")
	require.NoError(t, os.WriteFile(invalidName, []byte("keep"), 0o600))
	service.cleanupStagedRecordingFile(invalidName)

	_, err := os.Lstat(directory)
	require.NoError(t, err)
	content, err := os.ReadFile(invalidName)
	require.NoError(t, err)
	assert.Equal(t, []byte("keep"), content)
}

func TestRestoreStagedRecordingKeepsConflictsAndReportsMissingSource(t *testing.T) {
	dataDir := t.TempDir()
	recordingsDir := filepath.Join(dataDir, "recordings")
	require.NoError(t, os.MkdirAll(recordingsDir, 0o700))
	service := NewLogService(testutil.NewTestDB(t), dataDir, testutil.NewTestLogger())
	original := filepath.Join(recordingsDir, "recording.msshlog")
	staged := original + ".deleting-test"
	require.NoError(t, os.WriteFile(original, []byte("current"), 0o600))
	require.NoError(t, os.WriteFile(staged, []byte("staged"), 0o600))

	service.restoreStagedRecording(staged, original)
	service.restoreStagedRecording(filepath.Join(recordingsDir, "missing.deleting-test"), filepath.Join(recordingsDir, "missing"))

	content, err := os.ReadFile(original)
	require.NoError(t, err)
	assert.Equal(t, []byte("current"), content)
	content, err = os.ReadFile(staged)
	require.NoError(t, err)
	assert.Equal(t, []byte("staged"), content)
}
