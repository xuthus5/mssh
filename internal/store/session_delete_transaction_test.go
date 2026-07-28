package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestDeleteSessionsDefersPostCommitRecordingCleanupFailure(t *testing.T) {
	db, sessionID, recordingsDir, recordingPath := createSessionRecordingForDelete(t)

	err := deleteSessions(db, sessionDeleteRequest{
		ids:           []int64{sessionID},
		recordingsDir: recordingsDir,
		removeFile:    func(string) error { return assert.AnError },
	})

	assert.ErrorIs(t, err, ErrRecordingCleanupDeferred)
	assertTableRowCount(t, rowCountExpectation{
		db: db, table: "sessions", condition: "id = " + itoa(sessionID), expected: 0,
	})
	_, err = os.Lstat(recordingPath)
	assert.ErrorIs(t, err, os.ErrNotExist)
	staged, err := filepath.Glob(recordingPath + ".deleting-*")
	require.NoError(t, err)
	assert.Len(t, staged, 1)
}

func TestDeleteSessionsDefaultsRecordingRemover(t *testing.T) {
	db, sessionID, recordingsDir, recordingPath := createSessionRecordingForDelete(t)

	err := deleteSessions(db, sessionDeleteRequest{
		ids: []int64{sessionID}, recordingsDir: recordingsDir,
	})

	require.NoError(t, err)
	_, err = os.Lstat(recordingPath)
	assert.ErrorIs(t, err, os.ErrNotExist)
}

func TestDeleteSessionsRestoresStagedRecordingsWhenDatabaseDeleteFails(t *testing.T) {
	db, sessionID, recordingsDir, recordingPath := createSessionRecordingForDelete(t)
	_, err := db.Exec(`CREATE TRIGGER reject_session_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(FAIL, 'blocked'); END`)
	require.NoError(t, err)

	err = deleteSessions(db, sessionDeleteRequest{
		ids:           []int64{sessionID},
		recordingsDir: recordingsDir,
		removeFile:    removeRecordingFile,
	})

	assert.ErrorContains(t, err, "blocked")
	assertTableRowCount(t, rowCountExpectation{
		db: db, table: "sessions", condition: "id = " + itoa(sessionID), expected: 1,
	})
	content, err := os.ReadFile(recordingPath)
	require.NoError(t, err)
	assert.Equal(t, []byte("recording"), content)
	staged, err := filepath.Glob(recordingPath + ".deleting-*")
	require.NoError(t, err)
	assert.Empty(t, staged)
}

func TestDeleteSessionsRejectsRecordingSymlinkInsideTrustedDirectory(t *testing.T) {
	db, sessionID, recordingsDir, recordingPath := createSessionRecordingForDelete(t)
	targetPath := recordingPath + ".target"
	require.NoError(t, os.Rename(recordingPath, targetPath))
	if err := os.Symlink(targetPath, recordingPath); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	err := DeleteSessionsWithRecordingDirectory(db, []int64{sessionID}, recordingsDir)

	assert.ErrorContains(t, err, "regular file")
	assertTableRowCount(t, rowCountExpectation{
		db: db, table: "sessions", condition: "id = " + itoa(sessionID), expected: 1,
	})
	content, err := os.ReadFile(targetPath)
	require.NoError(t, err)
	assert.Equal(t, []byte("recording"), content)
}

func TestDeleteSessionsRollsBackEarlierRecordingsWhenLaterStageFails(t *testing.T) {
	db, sessionID, recordingsDir, recordingPath := createSessionRecordingForDelete(t)
	targetPath := filepath.Join(recordingsDir, "linked-target.msshlog")
	require.NoError(t, os.WriteFile(targetPath, []byte("linked"), 0o600))
	linkedPath := filepath.Join(recordingsDir, "linked.msshlog")
	if err := os.Symlink(targetPath, linkedPath); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	_, err := db.Exec(
		"INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)",
		sessionID,
		linkedPath,
	)
	require.NoError(t, err)

	err = DeleteSessionsWithRecordingDirectory(db, []int64{sessionID}, recordingsDir)

	assert.ErrorContains(t, err, "regular file")
	content, err := os.ReadFile(recordingPath)
	require.NoError(t, err)
	assert.Equal(t, []byte("recording"), content)
	staged, err := filepath.Glob(recordingPath + ".deleting-*")
	require.NoError(t, err)
	assert.Empty(t, staged)
}

func TestDeleteSessionsRestoresRecordingStillReferencedByAnotherLog(t *testing.T) {
	db, sessionID, recordingsDir, recordingPath := createSessionRecordingForDelete(t)
	remaining, err := CreateSession(db, model.Session{
		Name: "remaining", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	_, err = db.Exec(
		"INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)",
		remaining.ID,
		recordingPath,
	)
	require.NoError(t, err)

	require.NoError(t, DeleteSessionsWithRecordingDirectory(db, []int64{sessionID}, recordingsDir))

	content, err := os.ReadFile(recordingPath)
	require.NoError(t, err)
	assert.Equal(t, []byte("recording"), content)
	assertTableRowCount(t, rowCountExpectation{
		db: db, table: "sessions", condition: "id = " + itoa(remaining.ID), expected: 1,
	})
	staged, err := filepath.Glob(recordingPath + ".deleting-*")
	require.NoError(t, err)
	assert.Empty(t, staged)
}

func createSessionRecordingForDelete(t *testing.T) (*sql.DB, int64, string, string) {
	t.Helper()
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{
		Name: "recorded", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	recordingsDir := t.TempDir()
	recordingPath := filepath.Join(recordingsDir, "recording.msshlog")
	require.NoError(t, os.WriteFile(recordingPath, []byte("recording"), 0o600))
	_, err = db.Exec(
		"INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)",
		session.ID,
		recordingPath,
	)
	require.NoError(t, err)
	return db, session.ID, recordingsDir, recordingPath
}
