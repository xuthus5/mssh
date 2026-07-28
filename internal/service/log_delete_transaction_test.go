package service

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestLogServiceDeleteTreatsPostCommitCleanupFailureAsMaintenance(t *testing.T) {
	service, logID, path := createStoredRecording(t)
	service.removeFile = func(string) error { return assert.AnError }

	err := service.Delete(logID)

	require.NoError(t, err)
	_, err = store.GetSessionLog(service.db, logID)
	assert.Error(t, err)
	_, err = os.Lstat(path)
	assert.ErrorIs(t, err, os.ErrNotExist)
	staged, err := filepath.Glob(path + ".deleting-*")
	require.NoError(t, err)
	assert.Len(t, staged, 1)
}

func TestLogServiceDeleteRollsBackStagedFileWhenDatabaseDeleteFails(t *testing.T) {
	service, logID, path := createStoredRecording(t)
	_, err := service.db.Exec(`CREATE TRIGGER reject_log_delete BEFORE DELETE ON session_logs BEGIN SELECT RAISE(FAIL, 'blocked'); END`)
	require.NoError(t, err)

	err = service.Delete(logID)

	assert.ErrorContains(t, err, "blocked")
	_, err = store.GetSessionLog(service.db, logID)
	require.NoError(t, err)
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, []byte("recording"), content)
	staged, err := filepath.Glob(path + ".deleting-*")
	require.NoError(t, err)
	assert.Empty(t, staged)
}

func TestLogServiceDeleteRejectsRecordingSymlinkInsideDataDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	service, logID, path := createStoredRecording(t)
	target := path + ".target"
	require.NoError(t, os.Rename(path, target))
	require.NoError(t, os.Symlink(target, path))

	err := service.Delete(logID)

	assert.ErrorContains(t, err, "regular file")
	_, err = store.GetSessionLog(service.db, logID)
	require.NoError(t, err)
	content, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, []byte("recording"), content)
}

func TestLogServiceDeleteRejectsSymlinkedRecordingsDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	outsideDir := t.TempDir()
	recordingsDir := filepath.Join(dataDir, "recordings")
	require.NoError(t, os.Symlink(outsideDir, recordingsDir))
	outsidePath := filepath.Join(outsideDir, "recording.msshlog")
	require.NoError(t, os.WriteFile(outsidePath, []byte("must survive"), 0o600))
	storedPath := filepath.Join(recordingsDir, "recording.msshlog")
	service := NewLogService(db, dataDir, testutil.NewTestLogger())
	entry, err := service.createSessionLog(db, model.SessionLog{DataPath: storedPath})
	require.NoError(t, err)

	err = service.Delete(entry.ID)

	assert.ErrorContains(t, err, "recordings directory")
	content, err := os.ReadFile(outsidePath)
	require.NoError(t, err)
	assert.Equal(t, []byte("must survive"), content)
	_, err = store.GetSessionLog(db, entry.ID)
	require.NoError(t, err)
}

func TestNewLogServiceCleansStagedRecordingFiles(t *testing.T) {
	dataDir := t.TempDir()
	recordingsDir := filepath.Join(dataDir, "recordings")
	require.NoError(t, os.MkdirAll(recordingsDir, 0o700))
	staged := filepath.Join(recordingsDir, "recording.msshlog.deleting-stale")
	unrelated := filepath.Join(recordingsDir, "recording.msshlog")
	require.NoError(t, os.WriteFile(staged, []byte("stale"), 0o600))
	require.NoError(t, os.WriteFile(unrelated, []byte("active"), 0o600))

	_ = NewLogService(testutil.NewTestDB(t), dataDir, testutil.NewTestLogger())

	_, err := os.Lstat(staged)
	assert.ErrorIs(t, err, os.ErrNotExist)
	content, err := os.ReadFile(unrelated)
	require.NoError(t, err)
	assert.Equal(t, []byte("active"), content)
}

func TestNewLogServiceRestoresStagedRecordingStillReferencedByDatabase(t *testing.T) {
	service, logID, path := createStoredRecording(t)
	staged := path + ".deleting-interrupted"
	require.NoError(t, os.Rename(path, staged))

	_ = NewLogService(service.db, service.dataDir, testutil.NewTestLogger())

	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, []byte("recording"), content)
	_, err = os.Lstat(staged)
	assert.ErrorIs(t, err, os.ErrNotExist)
	_, err = store.GetSessionLog(service.db, logID)
	require.NoError(t, err)
}

func createStoredRecording(t *testing.T) (*LogService, int64, string) {
	t.Helper()
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	recordingsDir := filepath.Join(dataDir, "recordings")
	require.NoError(t, os.MkdirAll(recordingsDir, 0o700))
	path := filepath.Join(recordingsDir, "recording.msshlog")
	require.NoError(t, os.WriteFile(path, []byte("recording"), 0o600))
	service := NewLogService(db, dataDir, testutil.NewTestLogger())
	entry, err := service.createSessionLog(db, model.SessionLog{DataPath: path})
	require.NoError(t, err)
	return service, entry.ID, path
}
