package store

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

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
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("move folder: begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := ensureFolderExists(tx, id, "folder"); err != nil {
		return fmt.Errorf("move folder: %w", err)
	}
	if newParentID != nil {
		if *newParentID == id {
			return fmt.Errorf("move folder: folder cannot be its own parent")
		}
		if err := ensureFolderExists(tx, *newParentID, "parent folder"); err != nil {
			return fmt.Errorf("move folder: %w", err)
		}
		if err := ensureFolderNotDescendant(tx, id, *newParentID); err != nil {
			return fmt.Errorf("move folder: %w", err)
		}
	}
	result, err := tx.Exec(
		"UPDATE session_folders SET parent_id = ?, updated_at = datetime('now') WHERE id = ?",
		newParentID, id,
	)
	if err != nil {
		return fmt.Errorf("move folder: update: %w", err)
	}
	if err := requireAffected(result, "folder"); err != nil {
		return fmt.Errorf("move folder: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("move folder: commit transaction: %w", err)
	}
	return nil
}

func MoveSession(db *sql.DB, id int64, newFolderID *int64) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("move session: begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := ensureSessionExists(tx, id); err != nil {
		return fmt.Errorf("move session: %w", err)
	}
	if newFolderID != nil {
		if err := ensureFolderExists(tx, *newFolderID, "target folder"); err != nil {
			return fmt.Errorf("move session: %w", err)
		}
	}
	result, err := tx.Exec(
		"UPDATE sessions SET folder_id = ?, updated_at = datetime('now') WHERE id = ?",
		newFolderID, id,
	)
	if err != nil {
		return fmt.Errorf("move session: update: %w", err)
	}
	if err := requireAffected(result, "session"); err != nil {
		return fmt.Errorf("move session: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("move session: commit transaction: %w", err)
	}
	return nil
}

type folderTxQuerier interface {
	QueryRow(query string, args ...any) *sql.Row
}

func ensureFolderExists(tx folderTxQuerier, id int64, entity string) error {
	var foundID int64
	if err := tx.QueryRow("SELECT id FROM session_folders WHERE id = ?", id).Scan(&foundID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%s not found", entity)
		}
		return fmt.Errorf("check %s: %w", entity, err)
	}
	return nil
}

func ensureSessionExists(tx folderTxQuerier, id int64) error {
	var foundID int64
	if err := tx.QueryRow("SELECT id FROM sessions WHERE id = ?", id).Scan(&foundID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("session not found")
		}
		return fmt.Errorf("check session: %w", err)
	}
	return nil
}

// ensureFolderNotDescendant walks from the proposed parent toward the root.
// Encountering the moved folder would create a cycle; repeated ancestors
// indicate an already-corrupt hierarchy and are rejected as well.
func ensureFolderNotDescendant(tx folderTxQuerier, folderID, proposedParentID int64) error {
	visited := make(map[int64]struct{})
	current := proposedParentID
	for {
		if current == folderID {
			return errors.New("folder cannot be moved into its descendant")
		}
		if _, seen := visited[current]; seen {
			return errors.New("folder hierarchy contains a cycle")
		}
		visited[current] = struct{}{}

		var parentID sql.NullInt64
		if err := tx.QueryRow("SELECT parent_id FROM session_folders WHERE id = ?", current).Scan(&parentID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errors.New("parent folder not found")
			}
			return fmt.Errorf("check parent folder: %w", err)
		}
		if !parentID.Valid {
			return nil
		}
		current = parentID.Int64
	}
}
