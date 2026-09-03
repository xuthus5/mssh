package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func CreateFolder(db *sql.DB, name string, parentID *int64) (*model.SessionFolder, error) {
	result, err := db.Exec("INSERT INTO session_folders (name, parent_id) VALUES (?, ?)", name, parentID)
	if err != nil {
		return nil, fmt.Errorf("create folder: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create folder: last insert id: %w", err)
	}
	now := time.Now()
	return &model.SessionFolder{ID: id, Name: name, ParentID: parentID, CreatedAt: now, UpdatedAt: now}, nil
}

func ListFolders(db *sql.DB) ([]model.SessionFolder, error) {
	rows, err := db.Query("SELECT id, name, parent_id, is_default, sort_order, created_at, updated_at FROM session_folders ORDER BY sort_order, id")
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var folders []model.SessionFolder
	for rows.Next() {
		var folder model.SessionFolder
		var createdAt, updatedAt string
		if err := rows.Scan(&folder.ID, &folder.Name, &folder.ParentID, &folder.IsDefault, &folder.SortOrder, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan folder: %w", err)
		}
		folder.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
		if err != nil {
			return nil, fmt.Errorf("scan folder: parse created_at: %w", err)
		}
		folder.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", updatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan folder: parse updated_at: %w", err)
		}
		folders = append(folders, folder)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if folders == nil {
		folders = []model.SessionFolder{}
	}
	return folders, nil
}

func UpdateFolder(db *sql.DB, id int64, name string) error {
	if _, err := db.Exec("UPDATE session_folders SET name = ?, updated_at = datetime('now') WHERE id = ?", name, id); err != nil {
		return fmt.Errorf("update folder: %w", err)
	}
	return nil
}

func DeleteFolder(db *sql.DB, id int64) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var count int
	var isDefault bool
	if err := tx.QueryRow("SELECT (SELECT count(*) FROM session_folders), is_default FROM session_folders WHERE id = ?", id).Scan(&count, &isDefault); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	if count <= 1 {
		return fmt.Errorf("delete folder: at least one folder is required")
	}
	if isDefault {
		return fmt.Errorf("delete folder: default folder cannot be deleted")
	}
	var defaultID int64
	if err := tx.QueryRow("SELECT id FROM session_folders WHERE is_default = 1").Scan(&defaultID); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	if _, err := tx.Exec("UPDATE sessions SET folder_id = ? WHERE folder_id = ?", defaultID, id); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	if _, err := tx.Exec("UPDATE session_folders SET parent_id = ? WHERE parent_id = ?", defaultID, id); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	if _, err := tx.Exec("DELETE FROM session_folders WHERE id = ?", id); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	return nil
}
