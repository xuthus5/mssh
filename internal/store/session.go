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
	return CreateSessionWithTags(db, s, nil)
}

func CreateSessionWithTags(db *sql.DB, s model.Session, tagIDs []int64) (*model.Session, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if s.FolderID == nil {
		var defaultID int64
		if err := tx.QueryRow("SELECT id FROM session_folders WHERE is_default = 1").Scan(&defaultID); err != nil {
			return nil, fmt.Errorf("create session: default folder: %w", err)
		}
		s.FolderID = &defaultID
	}
	result, err := tx.Exec(
		`INSERT INTO sessions (folder_id, name, host, port, username, notes, environment_id, project_id, auth_method, password, key_id, keep_alive, term_type, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.FolderID, s.Name, s.Host, s.Port, s.Username, s.Notes, s.EnvironmentID, s.ProjectID, s.AuthMethod, s.Password, s.KeyID, s.KeepAlive, s.TermType, s.SortOrder,
	)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create session: last insert id: %w", err)
	}
	if err := replaceSessionTags(tx, id, tagIDs); err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	return GetSession(db, id)
}

func ListSessions(db *sql.DB, folderID *int64) ([]model.Session, error) {
	var rows *sql.Rows
	var err error
	if folderID != nil {
		rows, err = db.Query(
			sessionSelectColumns+`
			 FROM sessions s LEFT JOIN asset_environments e ON e.id = s.environment_id LEFT JOIN asset_projects p ON p.id = s.project_id WHERE s.folder_id = ? ORDER BY s.sort_order`, *folderID,
		)
	} else {
		rows, err = db.Query(
			sessionSelectColumns + `
			 FROM sessions s LEFT JOIN asset_environments e ON e.id = s.environment_id LEFT JOIN asset_projects p ON p.id = s.project_id ORDER BY s.sort_order`,
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := attachSessionTags(db, sessions); err != nil {
		return nil, err
	}
	return sessions, nil
}

func UpdateSession(db *sql.DB, s model.Session) error {
	return UpdateSessionWithTags(db, s, tagIDsFromAssets(s.Tags))
}

func UpdateSessionWithTags(db *sql.DB, s model.Session, tagIDs []int64) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("update session: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(
		`UPDATE sessions SET folder_id=?, name=?, host=?, port=?, username=?, notes=?, environment_id=?, project_id=?, auth_method=?, password=?, key_id=?, keep_alive=?, term_type=?, sort_order=?, updated_at=datetime('now')
		 WHERE id=?`,
		s.FolderID, s.Name, s.Host, s.Port, s.Username, s.Notes, s.EnvironmentID, s.ProjectID, s.AuthMethod, s.Password, s.KeyID, s.KeepAlive, s.TermType, s.SortOrder, s.ID,
	)
	if err != nil {
		return fmt.Errorf("update session: %w", err)
	}
	if err := requireAffected(result, "session"); err != nil {
		return err
	}
	if err := replaceSessionTags(tx, s.ID, tagIDs); err != nil {
		return fmt.Errorf("update session: %w", err)
	}
	return tx.Commit()
}

func GetSession(db *sql.DB, id int64) (*model.Session, error) {
	s, err := scanSession(db.QueryRow(sessionSelectColumns+" FROM sessions s LEFT JOIN asset_environments e ON e.id = s.environment_id LEFT JOIN asset_projects p ON p.id = s.project_id WHERE s.id = ?", id))
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	items := []model.Session{s}
	if err := attachSessionTags(db, items); err != nil {
		return nil, err
	}
	return &items[0], nil
}

func MarkSessionConnected(db *sql.DB, id int64) error {
	result, err := db.Exec("UPDATE sessions SET last_connected_at = datetime('now'), connection_count = connection_count + 1 WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("mark session connected: %w", err)
	}
	return requireAffected(result, "session")
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
