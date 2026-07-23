package store

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
)

func DeleteSession(db *sql.DB, id int64) error {
	return DeleteSessions(db, []int64{id})
}

// DeleteSessions removes sessions and dependent rows that lack ON DELETE CASCADE.
func DeleteSessions(db *sql.DB, ids []int64) error {
	if len(ids) == 0 {
		return fmt.Errorf("delete sessions: at least one id is required")
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	recordingPaths, err := listSessionRecordingPathsTx(tx, ids)
	if err != nil {
		return err
	}
	if err := deleteSessionsTx(tx, ids); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	removeRecordingFiles(recordingPaths)
	return nil
}

func listSessionRecordingPathsTx(tx *sql.Tx, ids []int64) ([]string, error) {
	placeholders, arguments := inPlaceholders(ids)
	rows, err := tx.Query("SELECT data_path FROM session_logs WHERE session_id IN ("+placeholders+") AND data_path != ''", arguments...)
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

func removeRecordingFiles(paths []string) {
	for _, path := range paths {
		if path == "" {
			continue
		}
		_ = os.Remove(path)
	}
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
