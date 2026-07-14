package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const sessionLogTimeLayout = "2006-01-02 15:04:05"

func normalizeSessionLogTime(value time.Time) time.Time {
	if value.IsZero() {
		value = time.Now()
	}
	return value.UTC().Truncate(time.Second)
}

func CreateSessionLog(db *sql.DB, l model.SessionLog) (*model.SessionLog, error) {
	l.StartedAt = normalizeSessionLogTime(l.StartedAt)
	startedAt := l.StartedAt.Format(sessionLogTimeLayout)
	var endedAt *string
	if l.EndedAt != nil {
		normalized := normalizeSessionLogTime(*l.EndedAt)
		l.EndedAt = &normalized
		s := normalized.Format(sessionLogTimeLayout)
		endedAt = &s
	}
	result, err := db.Exec(
		"INSERT INTO session_logs (session_id, started_at, ended_at, data_path) VALUES (?, ?, ?, ?)",
		l.SessionID, startedAt, endedAt, l.DataPath,
	)
	if err != nil {
		return nil, fmt.Errorf("create session log: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create session log: last insert id: %w", err)
	}
	l.ID = id
	return &l, nil
}

func ListSessionLogs(db *sql.DB) ([]model.SessionLog, error) {
	rows, err := db.Query("SELECT id, session_id, started_at, ended_at, data_path FROM session_logs ORDER BY started_at DESC")
	if err != nil {
		return nil, fmt.Errorf("list session logs: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var logs []model.SessionLog
	for rows.Next() {
		var l model.SessionLog
		var startedAt string
		var endedAt *string
		err := rows.Scan(&l.ID, &l.SessionID, &startedAt, &endedAt, &l.DataPath)
		if err != nil {
			return nil, fmt.Errorf("scan session log: %w", err)
		}
		l.StartedAt, err = time.Parse(sessionLogTimeLayout, startedAt)
		if err != nil {
			return nil, fmt.Errorf("scan session log: parse started_at: %w", err)
		}
		if endedAt != nil {
			t, err := time.Parse(sessionLogTimeLayout, *endedAt)
			if err != nil {
				return nil, fmt.Errorf("scan session log: parse ended_at: %w", err)
			}
			l.EndedAt = &t
		}
		logs = append(logs, l)
	}
	if logs == nil {
		logs = []model.SessionLog{}
	}
	return logs, rows.Err()
}

func UpdateSessionLog(db *sql.DB, l model.SessionLog) error {
	startedAt := normalizeSessionLogTime(l.StartedAt).Format(sessionLogTimeLayout)
	var endedAt *string
	if l.EndedAt != nil {
		s := normalizeSessionLogTime(*l.EndedAt).Format(sessionLogTimeLayout)
		endedAt = &s
	}
	_, err := db.Exec(
		"UPDATE session_logs SET session_id=?, started_at=?, ended_at=?, data_path=? WHERE id=?",
		l.SessionID, startedAt, endedAt, l.DataPath, l.ID,
	)
	if err != nil {
		return fmt.Errorf("update session log: %w", err)
	}
	return nil
}

func DeleteSessionLog(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM session_logs WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete session log: %w", err)
	}
	return nil
}

// GetSessionLog retrieves a single session log by ID.
func GetSessionLog(db *sql.DB, id int64) (*model.SessionLog, error) {
	var l model.SessionLog
	var startedAt string
	var endedAt *string
	err := db.QueryRow(
		"SELECT id, session_id, started_at, ended_at, data_path FROM session_logs WHERE id = ?", id,
	).Scan(&l.ID, &l.SessionID, &startedAt, &endedAt, &l.DataPath)
	if err != nil {
		return nil, fmt.Errorf("get session log: %w", err)
	}
	l.StartedAt, err = time.Parse(sessionLogTimeLayout, startedAt)
	if err != nil {
		return nil, fmt.Errorf("get session log: parse started_at: %w", err)
	}
	if endedAt != nil {
		t, err := time.Parse(sessionLogTimeLayout, *endedAt)
		if err != nil {
			return nil, fmt.Errorf("get session log: parse ended_at: %w", err)
		}
		l.EndedAt = &t
	}
	return &l, nil
}

// ListSessionLogsBySession lists session logs filtered by session ID at the SQL layer.
func ListSessionLogsBySession(db *sql.DB, sessionID int64) ([]model.SessionLog, error) {
	rows, err := db.Query(
		"SELECT id, session_id, started_at, ended_at, data_path FROM session_logs WHERE session_id = ? ORDER BY started_at DESC",
		sessionID,
	)
	if err != nil {
		return nil, fmt.Errorf("list session logs by session: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var logs []model.SessionLog
	for rows.Next() {
		var l model.SessionLog
		var startedAt string
		var endedAt *string
		err := rows.Scan(&l.ID, &l.SessionID, &startedAt, &endedAt, &l.DataPath)
		if err != nil {
			return nil, fmt.Errorf("scan session log: %w", err)
		}
		l.StartedAt, err = time.Parse(sessionLogTimeLayout, startedAt)
		if err != nil {
			return nil, fmt.Errorf("scan session log: parse started_at: %w", err)
		}
		if endedAt != nil {
			t, err := time.Parse(sessionLogTimeLayout, *endedAt)
			if err != nil {
				return nil, fmt.Errorf("scan session log: parse ended_at: %w", err)
			}
			l.EndedAt = &t
		}
		logs = append(logs, l)
	}
	if logs == nil {
		logs = []model.SessionLog{}
	}
	return logs, rows.Err()
}
