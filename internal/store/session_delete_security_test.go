package store

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestDeleteSessionsRejectsRecordingOutsideTrustedDirectory(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{
		Name: "unsafe-recording", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	outsidePath := filepath.Join(t.TempDir(), "sentinel.msshlog")
	require.NoError(t, os.WriteFile(outsidePath, []byte("must survive"), 0o600))
	_, err = db.Exec("INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)", session.ID, outsidePath)
	require.NoError(t, err)

	err = DeleteSessions(db, []int64{session.ID})
	require.Error(t, err)
	assert.ErrorContains(t, err, "recording directory")

	_, statErr := os.Stat(outsidePath)
	require.NoError(t, statErr)
	assertTableRowCount(t, rowCountExpectation{db: db, table: "sessions", condition: "id = " + itoa(session.ID), expected: 1})
}

func TestDeleteSessionsWithRecordingDirectoryRemovesTrustedRecording(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{
		Name: "safe-recording", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	recordingsDir := t.TempDir()
	recordingPath := filepath.Join(recordingsDir, "safe.msshlog")
	require.NoError(t, os.WriteFile(recordingPath, []byte("remove me"), 0o600))
	_, err = db.Exec("INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)", session.ID, recordingPath)
	require.NoError(t, err)

	require.NoError(t, DeleteSessionsWithRecordingDirectory(db, []int64{session.ID}, recordingsDir))
	_, statErr := os.Stat(recordingPath)
	assert.ErrorIs(t, statErr, os.ErrNotExist)
}

func TestDeleteSessionsWithMissingRecordingInsideTrustedDirectory(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{
		Name: "missing-recording", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	recordingsDir := t.TempDir()
	recordingPath := filepath.Join(recordingsDir, "missing.msshlog")
	_, err = db.Exec("INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)", session.ID, recordingPath)
	require.NoError(t, err)

	require.NoError(t, DeleteSessionsWithRecordingDirectory(db, []int64{session.ID}, recordingsDir))
	assertTableRowCount(t, rowCountExpectation{db: db, table: "sessions", condition: "id = " + itoa(session.ID), expected: 0})
}

func TestDeleteSessionsWithMissingRecordingDirectory(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{
		Name: "missing-recordings-directory", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	recordingsDir := filepath.Join(t.TempDir(), "recordings")
	recordingPath := filepath.Join(recordingsDir, "missing.msshlog")
	_, err = db.Exec("INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)", session.ID, recordingPath)
	require.NoError(t, err)

	require.NoError(t, DeleteSessionsWithRecordingDirectory(db, []int64{session.ID}, recordingsDir))
	assertTableRowCount(t, rowCountExpectation{db: db, table: "sessions", condition: "id = " + itoa(session.ID), expected: 0})
}

func TestDeleteSessionsRejectsRecordingSymlinkOutsideTrustedDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{
		Name: "symlink-recording", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	recordingsDir := t.TempDir()
	outsidePath := filepath.Join(t.TempDir(), "sentinel.msshlog")
	require.NoError(t, os.WriteFile(outsidePath, []byte("must survive"), 0o600))
	symlinkPath := filepath.Join(recordingsDir, "linked.msshlog")
	if err := os.Symlink(outsidePath, symlinkPath); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	_, err = db.Exec("INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)", session.ID, symlinkPath)
	require.NoError(t, err)

	err = DeleteSessionsWithRecordingDirectory(db, []int64{session.ID}, recordingsDir)
	require.Error(t, err)
	assert.ErrorContains(t, err, "outside recordings directory")
	_, statErr := os.Stat(outsidePath)
	require.NoError(t, statErr)
	assertTableRowCount(t, rowCountExpectation{db: db, table: "sessions", condition: "id = " + itoa(session.ID), expected: 1})
}

func TestDeleteSessionsRejectsMissingRecordingThroughSymlinkedParent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{
		Name: "symlink-parent-recording", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	recordingsDir := t.TempDir()
	outsideDir := t.TempDir()
	linkedDir := filepath.Join(recordingsDir, "linked")
	if err := os.Symlink(outsideDir, linkedDir); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	recordingPath := filepath.Join(linkedDir, "missing.msshlog")
	_, err = db.Exec("INSERT INTO session_logs (session_id, started_at, data_path) VALUES (?, datetime('now'), ?)", session.ID, recordingPath)
	require.NoError(t, err)

	err = DeleteSessionsWithRecordingDirectory(db, []int64{session.ID}, recordingsDir)
	require.Error(t, err)
	assert.ErrorContains(t, err, "outside recordings directory")
	assertTableRowCount(t, rowCountExpectation{db: db, table: "sessions", condition: "id = " + itoa(session.ID), expected: 1})
}

func itoa(value int64) string {
	return fmt.Sprintf("%d", value)
}
