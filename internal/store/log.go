package store

import (
	"database/sql"
	"fmt"
	"mssh/internal/model"
	"time"
)

func CreateSessionLog(db *sql.DB, l model.SessionLog) (*model.SessionLog, error) {
	startedAt := l.StartedAt.Format("2006-01-02 15:04:05")
	var endedAt *string
	if l.EndedAt != nil {
		s := l.EndedAt.Format("2006-01-02 15:04:05")
		endedAt = &s
	}
	result, err := db.Exec(
		"INSERT INTO session_logs (session_id, started_at, ended_at, data_path) VALUES (?, ?, ?, ?)",
		l.SessionID, startedAt, endedAt, l.DataPath,
	)
	if err != nil {
		return nil, fmt.Errorf("create session log: %w", err)
	}
	id, _ := result.LastInsertId()
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
		l.StartedAt, _ = time.Parse("2006-01-02 15:04:05", startedAt)
		if endedAt != nil {
			t, _ := time.Parse("2006-01-02 15:04:05", *endedAt)
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
	startedAt := l.StartedAt.Format("2006-01-02 15:04:05")
	var endedAt *string
	if l.EndedAt != nil {
		s := l.EndedAt.Format("2006-01-02 15:04:05")
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
