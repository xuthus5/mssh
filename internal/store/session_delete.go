package store

import (
	"database/sql"
	"fmt"
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
	if err := deleteSessionsTx(tx, ids); err != nil {
		return err
	}
	return tx.Commit()
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
