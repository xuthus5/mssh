package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

func (s *SessionService) importSessionCSVRecord(record sessionCSVRecord, policy model.SessionCSVConflictPolicy) (string, int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", 0, fmt.Errorf("begin row %d: %w", record.Row, err)
	}
	defer func() { _ = tx.Rollback() }()
	existingID, existingPassword, err := findSessionCSVConflict(tx, record)
	if err != nil {
		return "", 0, err
	}
	if existingID > 0 && policy == model.SessionCSVConflictSkip {
		return "skipped", existingID, nil
	}
	input, err := buildSessionCSVInput(tx, record)
	if err != nil {
		return "", 0, err
	}
	status := "imported"
	if existingID > 0 {
		status = "updated"
		input.ID = existingID
		if input.Password == "" {
			input.Password = existingPassword
		}
	}
	if err := validateSessionAssetInput(input, existingID > 0); err != nil {
		return "", 0, err
	}
	if err := s.sealSessionPasswordForCSV(&input, existingID > 0 && input.Password == existingPassword); err != nil {
		return "", 0, err
	}
	sessionID, err := persistSessionCSVInput(tx, input)
	if err != nil {
		return "", 0, err
	}
	if err := tx.Commit(); err != nil {
		return "", 0, fmt.Errorf("commit row %d: %w", record.Row, err)
	}
	return status, sessionID, nil
}

func buildSessionCSVInput(tx *sql.Tx, record sessionCSVRecord) (model.SessionInput, error) {
	folderID, err := resolveSessionCSVFolder(tx, record.FolderPath)
	if err != nil {
		return model.SessionInput{}, err
	}
	environmentID, err := resolveSessionCSVAsset(tx, "environment", record.Environment)
	if err != nil {
		return model.SessionInput{}, err
	}
	projectID, err := resolveSessionCSVAsset(tx, "project", record.Project)
	if err != nil {
		return model.SessionInput{}, err
	}
	tagIDs, err := resolveSessionCSVTags(tx, record.Tags)
	if err != nil {
		return model.SessionInput{}, err
	}
	keyID, err := resolveSessionCSVKey(tx, record)
	if err != nil {
		return model.SessionInput{}, err
	}
	return model.SessionInput{
		FolderID: &folderID, Name: record.Name, Host: record.Host, Port: record.Port, Username: record.Username,
		Notes: record.Notes, EnvironmentID: environmentID, ProjectID: projectID, TagIDs: tagIDs,
		AuthMethod: record.AuthMethod, Password: record.Password, KeyID: keyID, KeepAlive: record.KeepAlive,
		TermType: record.TermType,
	}, nil
}

func findSessionCSVConflict(tx *sql.Tx, record sessionCSVRecord) (int64, string, error) {
	var id int64
	var password sql.NullString
	err := tx.QueryRow(
		"SELECT id, password FROM sessions WHERE name=? AND host=? AND port=? AND username=? ORDER BY id LIMIT 1",
		record.Name, record.Host, record.Port, record.Username,
	).Scan(&id, &password)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", nil
	}
	if err != nil {
		return 0, "", fmt.Errorf("find session conflict: %w", err)
	}
	return id, password.String, nil
}

func persistSessionCSVInput(tx *sql.Tx, input model.SessionInput) (int64, error) {
	if input.ID > 0 {
		if err := updateSessionCSVInput(tx, input); err != nil {
			return 0, err
		}
		return input.ID, nil
	}
	result, err := tx.Exec(
		`INSERT INTO sessions (folder_id, name, host, port, username, notes, environment_id, project_id, auth_method, password, key_id, keep_alive, term_type, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.FolderID, input.Name, input.Host, input.Port, input.Username, input.Notes, input.EnvironmentID,
		input.ProjectID, input.AuthMethod, input.Password, input.KeyID, input.KeepAlive, input.TermType, input.SortOrder,
	)
	if err != nil {
		return 0, fmt.Errorf("insert session: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("insert session id: %w", err)
	}
	if err := replaceSessionCSVTags(tx, id, input.TagIDs); err != nil {
		return 0, err
	}
	return id, nil
}

func updateSessionCSVInput(tx *sql.Tx, input model.SessionInput) error {
	result, err := tx.Exec(
		`UPDATE sessions SET folder_id=?, name=?, host=?, port=?, username=?, notes=?, environment_id=?, project_id=?, auth_method=?, password=?, key_id=?, keep_alive=?, term_type=?, sort_order=?, updated_at=datetime('now') WHERE id=?`,
		input.FolderID, input.Name, input.Host, input.Port, input.Username, input.Notes, input.EnvironmentID,
		input.ProjectID, input.AuthMethod, input.Password, input.KeyID, input.KeepAlive, input.TermType, input.SortOrder, input.ID,
	)
	if err != nil {
		return fmt.Errorf("update session: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update session rows: %w", err)
	}
	if count != 1 {
		return fmt.Errorf("update session: session %d not found", input.ID)
	}
	return replaceSessionCSVTags(tx, input.ID, input.TagIDs)
}

func replaceSessionCSVTags(tx *sql.Tx, sessionID int64, tagIDs []int64) error {
	if _, err := tx.Exec("DELETE FROM session_tags WHERE session_id=?", sessionID); err != nil {
		return fmt.Errorf("replace session tags: %w", err)
	}
	for _, tagID := range tagIDs {
		if _, err := tx.Exec("INSERT INTO session_tags (session_id, tag_id) VALUES (?, ?)", sessionID, tagID); err != nil {
			return fmt.Errorf("replace session tags: %w", err)
		}
	}
	return nil
}

// sealSessionPasswordForCSV encrypts plaintext passwords from CSV rows.
// keepSealed is true when the password already came from the DB ciphertext.
func (s *SessionService) sealSessionPasswordForCSV(input *model.SessionInput, keepSealed bool) error {
	if input == nil || input.Password == "" || keepSealed {
		return nil
	}
	if strings.HasPrefix(input.Password, sessionPasswordPrefix) {
		return nil
	}
	if s.crypto == nil {
		// Test fixtures and legacy bootstraps without vault crypto store plaintext.
		return nil
	}
	sealed, err := sealSessionPassword(s.crypto, input.Password)
	if err != nil {
		return fmt.Errorf("encrypt session password: %w", err)
	}
	input.Password = sealed
	return nil
}
