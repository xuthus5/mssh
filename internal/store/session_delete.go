package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

func DeleteSession(db *sql.DB, id int64) error {
	return DeleteSessions(db, []int64{id})
}

func DeleteSessionWithRecordingDirectory(db *sql.DB, id int64, recordingsDir string) error {
	return DeleteSessionsWithRecordingDirectory(db, []int64{id}, recordingsDir)
}

// DeleteSessions removes sessions and dependent rows that lack ON DELETE CASCADE.
func DeleteSessions(db *sql.DB, ids []int64) error {
	return deleteSessions(db, sessionDeleteRequest{ids: ids, removeFile: removeRecordingFile})
}

// DeleteSessionsWithRecordingDirectory removes sessions and trusted recording files.
func DeleteSessionsWithRecordingDirectory(db *sql.DB, ids []int64, recordingsDir string) error {
	return deleteSessions(db, sessionDeleteRequest{
		ids: ids, recordingsDir: recordingsDir, removeFile: removeRecordingFile,
	})
}

func deleteSessions(db *sql.DB, request sessionDeleteRequest) error {
	if len(request.ids) == 0 {
		return fmt.Errorf("delete sessions: at least one id is required")
	}
	if request.removeFile == nil {
		request.removeFile = removeRecordingFile
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	recordingPaths, err := listSessionRecordingPathsTx(tx, request.ids)
	if err != nil {
		return err
	}
	if len(recordingPaths) > 0 {
		if strings.TrimSpace(request.recordingsDir) == "" {
			return fmt.Errorf("delete sessions: recording directory is required")
		}
		if err := validateRecordingPaths(recordingPaths, request.recordingsDir); err != nil {
			return fmt.Errorf("delete sessions: %w", err)
		}
	}
	staged, err := stageSessionRecordings(recordingPaths)
	if err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	if err := deleteSessionsTx(tx, request.ids); err != nil {
		return errors.Join(err, rollbackSessionDelete(tx), rollbackStagedSessionRecordings(staged))
	}
	if err := tx.Commit(); err != nil {
		recoveryErr := reconcileStagedSessionRecordings(db, staged, request.removeFile)
		return errors.Join(fmt.Errorf("delete sessions: commit: %w", err), recoveryErr)
	}
	if err := reconcileStagedSessionRecordings(db, staged, request.removeFile); err != nil {
		return errors.Join(ErrRecordingCleanupDeferred, err)
	}
	return nil
}

func listSessionRecordingPathsTx(tx *sql.Tx, ids []int64) ([]string, error) {
	placeholders, arguments := inPlaceholders(ids)
	query := "SELECT data_path FROM session_logs WHERE session_id IN (" + placeholders + ")" +
		" AND data_path != '' ORDER BY id"
	rows, err := tx.Query(query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("delete sessions: list recordings: %w", err)
	}
	defer func() { _ = rows.Close() }()

	paths := make([]string, 0)
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return nil, fmt.Errorf("delete sessions: scan recording path: %w", err)
		}
		if path != "" {
			paths = append(paths, path)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("delete sessions: recording paths: %w", err)
	}
	return paths, nil
}

func deleteSessionsTx(tx *sql.Tx, ids []int64) error {
	placeholders, arguments := inPlaceholders(ids)
	// tunnels / session_logs do not cascade with the current schema.
	if _, err := tx.Exec("DELETE FROM tunnels WHERE session_id IN ("+placeholders+")", arguments...); err != nil {
		return fmt.Errorf("delete sessions: tunnels: %w", err)
	}
	if _, err := tx.Exec("DELETE FROM session_logs WHERE session_id IN ("+placeholders+")", arguments...); err != nil {
		return fmt.Errorf("delete sessions: session_logs: %w", err)
	}
	result, err := tx.Exec("DELETE FROM sessions WHERE id IN ("+placeholders+")", arguments...)
	if err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete sessions: rows: %w", err)
	}
	if count != int64(len(ids)) {
		return fmt.Errorf("delete sessions: expected %d rows, deleted %d", len(ids), count)
	}
	return nil
}

func inPlaceholders(ids []int64) (string, []any) {
	placeholders := make([]string, len(ids))
	arguments := make([]any, len(ids))
	for index, id := range ids {
		placeholders[index] = "?"
		arguments[index] = id
	}
	return strings.Join(placeholders, ","), arguments
}
