package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func CreateFolder(db *sql.DB, name string, parentID *int64) (*model.SessionFolder, error) {
	result, err := db.Exec(
		"INSERT INTO session_folders (name, parent_id) VALUES (?, ?)",
		name, parentID,
	)
	if err != nil {
		return nil, fmt.Errorf("create folder: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create folder: last insert id: %w", err)
	}
	return &model.SessionFolder{ID: id, Name: name, ParentID: parentID, CreatedAt: time.Now(), UpdatedAt: time.Now()}, nil
}

func ListFolders(db *sql.DB) ([]model.SessionFolder, error) {
	rows, err := db.Query(
		"SELECT id, name, parent_id, is_default, sort_order, created_at, updated_at FROM session_folders ORDER BY sort_order, id",
	)
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var folders []model.SessionFolder
	for rows.Next() {
		var f model.SessionFolder
		var createdAt, updatedAt string
		err := rows.Scan(&f.ID, &f.Name, &f.ParentID, &f.IsDefault, &f.SortOrder, &createdAt, &updatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan folder: %w", err)
		}
		f.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
		if err != nil {
			return nil, fmt.Errorf("scan folder: parse created_at: %w", err)
		}
		f.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", updatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan folder: parse updated_at: %w", err)
		}
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

func SetDefaultFolder(db *sql.DB, id int64) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("set default folder: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var exists int
	if err := tx.QueryRow("SELECT count(*) FROM session_folders WHERE id = ?", id).Scan(&exists); err != nil {
		return fmt.Errorf("set default folder: %w", err)
	}
	if exists == 0 {
		return fmt.Errorf("set default folder: folder not found")
	}
	if _, err := tx.Exec("UPDATE session_folders SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END, parent_id = CASE WHEN id = ? THEN NULL ELSE parent_id END, updated_at = datetime('now')", id, id); err != nil {
		return fmt.Errorf("set default folder: %w", err)
	}
	return tx.Commit()
}

func GetDefaultFolderID(db *sql.DB) (int64, error) {
	var id int64
	if err := db.QueryRow("SELECT id FROM session_folders WHERE is_default = 1").Scan(&id); err != nil {
		return 0, fmt.Errorf("get default folder: %w", err)
	}
	return id, nil
}

func CreateSession(db *sql.DB, s model.Session) (*model.Session, error) {
	if s.FolderID == nil {
		defaultID, err := GetDefaultFolderID(db)
		if err != nil {
			return nil, err
		}
		s.FolderID = &defaultID
	}
	result, err := db.Exec(
		`INSERT INTO sessions (folder_id, name, host, port, username, tags, notes, environment, project, auth_method, password, key_id, keep_alive, term_type, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.FolderID, s.Name, s.Host, s.Port, s.Username, s.Tags, s.Notes, s.Environment, s.Project, s.AuthMethod, s.Password, s.KeyID, s.KeepAlive, s.TermType, s.SortOrder,
	)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create session: last insert id: %w", err)
	}
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
			sessionSelectColumns+`
			 FROM sessions WHERE folder_id = ? ORDER BY sort_order`, *folderID,
		)
	} else {
		rows, err = db.Query(
			sessionSelectColumns + `
			 FROM sessions ORDER BY sort_order`,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var sessions []model.Session
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, s)
	}
	if sessions == nil {
		sessions = []model.Session{}
	}
	return sessions, rows.Err()
}

func UpdateSession(db *sql.DB, s model.Session) error {
	_, err := db.Exec(
		`UPDATE sessions SET folder_id=?, name=?, host=?, port=?, username=?, tags=?, notes=?, environment=?, project=?, auth_method=?, password=?, key_id=?, keep_alive=?, term_type=?, sort_order=?, updated_at=datetime('now')
		 WHERE id=?`,
		s.FolderID, s.Name, s.Host, s.Port, s.Username, s.Tags, s.Notes, s.Environment, s.Project, s.AuthMethod, s.Password, s.KeyID, s.KeepAlive, s.TermType, s.SortOrder, s.ID,
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

func GetSession(db *sql.DB, id int64) (*model.Session, error) {
	s, err := scanSession(db.QueryRow(sessionSelectColumns+" FROM sessions WHERE id = ?", id))
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	return &s, nil
}

const sessionSelectColumns = `SELECT id, folder_id, name, host, port, username, tags, notes, environment, project, auth_method, password, key_id, keep_alive, term_type, sort_order, last_connected_at, connection_count, created_at, updated_at`

type sessionScanner interface{ Scan(...any) error }

func scanSession(scanner sessionScanner) (model.Session, error) {
	var session model.Session
	var lastConnected sql.NullString
	var createdAt, updatedAt string
	err := scanner.Scan(&session.ID, &session.FolderID, &session.Name, &session.Host, &session.Port, &session.Username, &session.Tags, &session.Notes, &session.Environment, &session.Project, &session.AuthMethod, &session.Password, &session.KeyID, &session.KeepAlive, &session.TermType, &session.SortOrder, &lastConnected, &session.ConnectionCount, &createdAt, &updatedAt)
	if err != nil {
		return session, err
	}
	if lastConnected.Valid {
		parsed, parseErr := time.Parse("2006-01-02 15:04:05", lastConnected.String)
		if parseErr != nil {
			return session, fmt.Errorf("parse last_connected_at: %w", parseErr)
		}
		session.LastConnectedAt = &parsed
	}
	var parseErr error
	session.CreatedAt, parseErr = time.Parse("2006-01-02 15:04:05", createdAt)
	if parseErr != nil {
		return session, fmt.Errorf("parse created_at: %w", parseErr)
	}
	session.UpdatedAt, parseErr = time.Parse("2006-01-02 15:04:05", updatedAt)
	if parseErr != nil {
		return session, fmt.Errorf("parse updated_at: %w", parseErr)
	}
	return session, nil
}

func MarkSessionConnected(db *sql.DB, id int64) error {
	result, err := db.Exec("UPDATE sessions SET last_connected_at = datetime('now'), connection_count = connection_count + 1 WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("mark session connected: %w", err)
	}
	return requireAffected(result, "session")
}

func ListRecentSessions(db *sql.DB, limit int) ([]model.Session, error) {
	if limit < 1 || limit > 10 {
		limit = 10
	}
	rows, err := db.Query(sessionSelectColumns+" FROM sessions WHERE last_connected_at IS NOT NULL ORDER BY last_connected_at DESC, id DESC LIMIT ?", limit)
	if err != nil {
		return nil, fmt.Errorf("list recent sessions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	sessions := make([]model.Session, 0, limit)
	for rows.Next() {
		session, scanErr := scanSession(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan recent session: %w", scanErr)
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func MoveFolder(db *sql.DB, id int64, newParentID *int64) error {
	_, err := db.Exec(
		"UPDATE session_folders SET parent_id = ?, updated_at = datetime('now') WHERE id = ?",
		newParentID, id,
	)
	if err != nil {
		return fmt.Errorf("move folder: %w", err)
	}
	return nil
}

func MoveSession(db *sql.DB, id int64, newFolderID *int64) error {
	_, err := db.Exec(
		"UPDATE sessions SET folder_id = ?, updated_at = datetime('now') WHERE id = ?",
		newFolderID, id,
	)
	if err != nil {
		return fmt.Errorf("move session: %w", err)
	}
	return nil
}
