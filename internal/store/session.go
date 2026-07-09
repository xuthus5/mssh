package store

import (
	"database/sql"
	"fmt"
	"time"

	"mssh/internal/model"
)

func CreateFolder(db *sql.DB, name string, parentID *int64) (*model.SessionFolder, error) {
	result, err := db.Exec(
		"INSERT INTO session_folders (name, parent_id) VALUES (?, ?)",
		name, parentID,
	)
	if err != nil {
		return nil, fmt.Errorf("create folder: %w", err)
	}
	id, _ := result.LastInsertId()
	return &model.SessionFolder{ID: id, Name: name, ParentID: parentID, CreatedAt: time.Now(), UpdatedAt: time.Now()}, nil
}

func ListFolders(db *sql.DB) ([]model.SessionFolder, error) {
	rows, err := db.Query(
		"SELECT id, name, parent_id, sort_order, created_at, updated_at FROM session_folders ORDER BY sort_order",
	)
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}
	defer rows.Close()
	var folders []model.SessionFolder
	for rows.Next() {
		var f model.SessionFolder
		var createdAt, updatedAt string
		err := rows.Scan(&f.ID, &f.Name, &f.ParentID, &f.SortOrder, &createdAt, &updatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan folder: %w", err)
		}
		f.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
		f.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
		folders = append(folders, f)
	}
	if folders == nil {
		folders = []model.SessionFolder{}
	}
	return folders, rows.Err()
}

func UpdateFolder(db *sql.DB, id int64, name string) error {
	_, err := db.Exec(
		"UPDATE session_folders SET name = ?, updated_at = datetime('now') WHERE id = ?",
		name, id,
	)
	if err != nil {
		return fmt.Errorf("update folder: %w", err)
	}
	return nil
}

func DeleteFolder(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM session_folders WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	return nil
}

func CreateSession(db *sql.DB, s model.Session) (*model.Session, error) {
	result, err := db.Exec(
		`INSERT INTO sessions (folder_id, name, host, port, username, auth_method, password, key_id, keep_alive, term_type, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.FolderID, s.Name, s.Host, s.Port, s.Username, s.AuthMethod, s.Password, s.KeyID, s.KeepAlive, s.TermType, s.SortOrder,
	)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	id, _ := result.LastInsertId()
	s.ID = id
	s.CreatedAt = time.Now()
	s.UpdatedAt = time.Now()
	return &s, nil
}

func ListSessions(db *sql.DB, folderID *int64) ([]model.Session, error) {
	var rows *sql.Rows
	var err error
	if folderID != nil {
		rows, err = db.Query(
			`SELECT id, folder_id, name, host, port, username, auth_method, password, key_id, keep_alive, term_type, sort_order, created_at, updated_at
			 FROM sessions WHERE folder_id = ? ORDER BY sort_order`, *folderID,
		)
	} else {
		rows, err = db.Query(
			`SELECT id, folder_id, name, host, port, username, auth_method, password, key_id, keep_alive, term_type, sort_order, created_at, updated_at
			 FROM sessions ORDER BY sort_order`,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()
	var sessions []model.Session
	for rows.Next() {
		var s model.Session
		var createdAt, updatedAt string
		err := rows.Scan(&s.ID, &s.FolderID, &s.Name, &s.Host, &s.Port, &s.Username, &s.AuthMethod, &s.Password, &s.KeyID, &s.KeepAlive, &s.TermType, &s.SortOrder, &createdAt, &updatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		s.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
		s.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
		sessions = append(sessions, s)
	}
	if sessions == nil {
		sessions = []model.Session{}
	}
	return sessions, rows.Err()
}

func UpdateSession(db *sql.DB, s model.Session) error {
	_, err := db.Exec(
		`UPDATE sessions SET folder_id=?, name=?, host=?, port=?, username=?, auth_method=?, password=?, key_id=?, keep_alive=?, term_type=?, sort_order=?, updated_at=datetime('now')
		 WHERE id=?`,
		s.FolderID, s.Name, s.Host, s.Port, s.Username, s.AuthMethod, s.Password, s.KeyID, s.KeepAlive, s.TermType, s.SortOrder, s.ID,
	)
	if err != nil {
		return fmt.Errorf("update session: %w", err)
	}
	return nil
}

func DeleteSession(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM sessions WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}
