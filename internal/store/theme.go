package store

import (
	"database/sql"
	"fmt"
	"time"

	"mssh/internal/model"
)

func CreateTheme(db *sql.DB, t model.Theme) (*model.Theme, error) {
	result, err := db.Exec(
		"INSERT INTO themes (name, is_builtin, config) VALUES (?, ?, ?)",
		t.Name, t.IsBuiltin, t.Config,
	)
	if err != nil {
		return nil, fmt.Errorf("create theme: %w", err)
	}
	id, _ := result.LastInsertId()
	t.ID = id
	t.CreatedAt = time.Now()
	return &t, nil
}

func ListThemes(db *sql.DB) ([]model.Theme, error) {
	rows, err := db.Query("SELECT id, name, is_builtin, config, created_at FROM themes ORDER BY created_at DESC")
	if err != nil {
		return nil, fmt.Errorf("list themes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var themes []model.Theme
	for rows.Next() {
		var t model.Theme
		var createdAt string
		err := rows.Scan(&t.ID, &t.Name, &t.IsBuiltin, &t.Config, &createdAt)
		if err != nil {
			return nil, fmt.Errorf("scan theme: %w", err)
		}
		t.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
		themes = append(themes, t)
	}
	if themes == nil {
		themes = []model.Theme{}
	}
	return themes, rows.Err()
}

func UpdateTheme(db *sql.DB, t model.Theme) error {
	_, err := db.Exec(
		"UPDATE themes SET name=?, is_builtin=?, config=? WHERE id=?",
		t.Name, t.IsBuiltin, t.Config, t.ID,
	)
	if err != nil {
		return fmt.Errorf("update theme: %w", err)
	}
	return nil
}

func DeleteTheme(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM themes WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete theme: %w", err)
	}
	return nil
}
