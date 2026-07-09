package store

import (
	"database/sql"
	"fmt"
	"time"

	"mssh/internal/model"
)

func CreateMacro(db *sql.DB, m model.Macro) (*model.Macro, error) {
	result, err := db.Exec(
		"INSERT INTO macros (name, command, shortcut, delay_ms, sort_order) VALUES (?, ?, ?, ?, ?)",
		m.Name, m.Command, m.Shortcut, m.DelayMs, m.SortOrder,
	)
	if err != nil {
		return nil, fmt.Errorf("create macro: %w", err)
	}
	id, _ := result.LastInsertId()
	m.ID = id
	m.CreatedAt = time.Now()
	return &m, nil
}

//nolint:dupl // CRUD pattern
func ListMacros(db *sql.DB) ([]model.Macro, error) {
	rows, err := db.Query("SELECT id, name, command, shortcut, delay_ms, sort_order, created_at FROM macros ORDER BY sort_order")
	if err != nil {
		return nil, fmt.Errorf("list macros: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var macros []model.Macro
	for rows.Next() {
		var m model.Macro
		var createdAt string
		err := rows.Scan(&m.ID, &m.Name, &m.Command, &m.Shortcut, &m.DelayMs, &m.SortOrder, &createdAt)
		if err != nil {
			return nil, fmt.Errorf("scan macro: %w", err)
		}
		m.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
		macros = append(macros, m)
	}
	if macros == nil {
		macros = []model.Macro{}
	}
	return macros, rows.Err()
}

func UpdateMacro(db *sql.DB, m model.Macro) error {
	_, err := db.Exec(
		"UPDATE macros SET name=?, command=?, shortcut=?, delay_ms=?, sort_order=? WHERE id=?",
		m.Name, m.Command, m.Shortcut, m.DelayMs, m.SortOrder, m.ID,
	)
	if err != nil {
		return fmt.Errorf("update macro: %w", err)
	}
	return nil
}

func DeleteMacro(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM macros WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete macro: %w", err)
	}
	return nil
}
