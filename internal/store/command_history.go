package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func AddCommandHistory(db *sql.DB, sessionID int64, command string) (*model.CommandHistory, error) {
	result, err := db.Exec("INSERT INTO command_history (session_id, command) VALUES (?, ?)", sessionID, command)
	if err != nil {
		return nil, fmt.Errorf("add command history: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("add command history id: %w", err)
	}
	return &model.CommandHistory{ID: id, SessionID: sessionID, Command: command, CreatedAt: time.Now()}, nil
}

func ListCommandHistory(db *sql.DB, sessionID int64, query string, limit int) ([]model.CommandHistory, error) {
	rows, err := db.Query("SELECT id, session_id, command, created_at FROM command_history WHERE session_id = ? AND command LIKE ? ORDER BY id DESC LIMIT ?", sessionID, "%"+query+"%", limit)
	if err != nil {
		return nil, fmt.Errorf("list command history: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := []model.CommandHistory{}
	for rows.Next() {
		var item model.CommandHistory
		var created string
		if err := rows.Scan(&item.ID, &item.SessionID, &item.Command, &created); err != nil {
			return nil, fmt.Errorf("scan command history: %w", err)
		}
		item.CreatedAt, err = time.Parse("2006-01-02 15:04:05", created)
		if err != nil {
			return nil, fmt.Errorf("parse command history time: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func DeleteCommandHistory(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM command_history WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete command history: %w", err)
	}
	return nil
}

func ClearCommandHistory(db *sql.DB, sessionID int64) error {
	_, err := db.Exec("DELETE FROM command_history WHERE session_id = ?", sessionID)
	if err != nil {
		return fmt.Errorf("clear command history: %w", err)
	}
	return nil
}
