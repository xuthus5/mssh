package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStageSessionRecordingHandlesMissingAndNonRegularPaths(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing.msshlog")
	recording, err := stageSessionRecording(missing)
	require.NoError(t, err)
	assert.False(t, recording.exists)
	assert.Equal(t, missing, recording.originalPath)

	directory := filepath.Join(t.TempDir(), "recording.msshlog")
	require.NoError(t, os.Mkdir(directory, 0o700))
	_, err = stageSessionRecording(directory)
	assert.ErrorContains(t, err, "regular file")

	longPath := filepath.Join(t.TempDir(), strings.Repeat("a", 220)+".msshlog")
	if err := os.WriteFile(longPath, []byte("recording"), 0o600); err != nil {
		t.Skipf("long filename unavailable: %v", err)
	}
	_, err = stageSessionRecording(longPath)
	assert.ErrorContains(t, err, "stage recording deletion")
}

func TestValidateStagedSessionRecordingRejectsMissingAndChangedFiles(t *testing.T) {
	directory := t.TempDir()
	original := filepath.Join(directory, "original.msshlog")
	require.NoError(t, os.WriteFile(original, []byte("original"), 0o600))
	originalInfo, err := os.Lstat(original)
	require.NoError(t, err)

	_, err = validateStagedSessionRecording(stagedSessionRecording{
		originalPath: original,
		stagedPath:   filepath.Join(directory, "missing.msshlog"),
		exists:       true,
	}, originalInfo)
	assert.ErrorContains(t, err, "inspect staged recording")

	staged := filepath.Join(directory, "changed.msshlog")
	require.NoError(t, os.WriteFile(staged, []byte("changed"), 0o600))
	_, err = validateStagedSessionRecording(stagedSessionRecording{
		originalPath: original,
		stagedPath:   staged,
		exists:       true,
	}, originalInfo)
	assert.ErrorContains(t, err, "changed while staging")
	content, readErr := os.ReadFile(original)
	require.NoError(t, readErr)
	assert.Equal(t, []byte("changed"), content)
}

func TestStagedSessionRecordingHandlesNoopAndCleanupErrors(t *testing.T) {
	recording := stagedSessionRecording{}
	assert.NoError(t, recording.rollback())
	assert.NoError(t, recording.remove(nil))

	recording = stagedSessionRecording{exists: true, stagedPath: "missing"}
	assert.ErrorContains(t, recording.rollback(), "restore")
	assert.ErrorContains(t, recording.remove(nil), "remover")
	assert.NoError(t, recording.remove(func(string) error { return os.ErrNotExist }))
}

func TestSessionRecordingReferenceReportsClosedDatabase(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())

	_, err := sessionRecordingPathReferenced(db, "recording.msshlog")
	assert.ErrorContains(t, err, "check recording reference")
	err = reconcileStagedSessionRecording(db, stagedSessionRecording{
		databasePath: "recording.msshlog", exists: true,
	}, removeRecordingFile)
	assert.ErrorContains(t, err, "check recording reference")
}

func TestRollbackSessionDeleteIgnoresCompletedTransaction(t *testing.T) {
	db := setupTestDB(t)
	tx, err := db.Begin()
	require.NoError(t, err)
	require.NoError(t, tx.Rollback())

	assert.NoError(t, rollbackSessionDelete(tx))
}
