package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const sessionSelectColumns = `SELECT s.id, s.folder_id, s.name, s.host, s.port, s.username, s.notes, s.environment_id, s.project_id, s.auth_method, s.password, s.key_id, s.keep_alive, s.term_type, s.sort_order, s.last_connected_at, s.connection_count, s.created_at, s.updated_at,
	e.id, e.name, e.color_token, e.sort_order, e.created_at, e.updated_at,
	p.id, p.name, p.code, p.description, p.sort_order, p.created_at, p.updated_at`

type sessionScanner interface{ Scan(...any) error }

func scanSession(scanner sessionScanner) (model.Session, error) {
	var session model.Session
	var password, lastConnected sql.NullString
	var createdAt, updatedAt string
	var environmentID, environmentSort, projectID, projectSort sql.NullInt64
	var environmentName, environmentColor, environmentCreated, environmentUpdated sql.NullString
	var projectName, projectCode, projectDescription, projectCreated, projectUpdated sql.NullString
	err := scanner.Scan(&session.ID, &session.FolderID, &session.Name, &session.Host, &session.Port, &session.Username, &session.Notes, &session.EnvironmentID, &session.ProjectID, &session.AuthMethod, &password, &session.KeyID, &session.KeepAlive, &session.TermType, &session.SortOrder, &lastConnected, &session.ConnectionCount, &createdAt, &updatedAt,
		&environmentID, &environmentName, &environmentColor, &environmentSort, &environmentCreated, &environmentUpdated,
		&projectID, &projectName, &projectCode, &projectDescription, &projectSort, &projectCreated, &projectUpdated)
	if err != nil {
		return session, err
	}
	if err := applyOptionalSessionFields(&session, password, lastConnected); err != nil {
		return session, err
	}
	if environmentID.Valid {
		environment := model.AssetEnvironment{ID: environmentID.Int64, Name: environmentName.String, ColorToken: model.AssetColorToken(environmentColor.String), SortOrder: int(environmentSort.Int64)}
		if err := parseAssetTimes(environmentCreated.String, environmentUpdated.String, &environment.CreatedAt, &environment.UpdatedAt); err != nil {
			return session, err
		}
		session.Environment = &environment
	}
	if projectID.Valid {
		project := model.AssetProject{ID: projectID.Int64, Name: projectName.String, Code: projectCode.String, Description: projectDescription.String, SortOrder: int(projectSort.Int64)}
		if err := parseAssetTimes(projectCreated.String, projectUpdated.String, &project.CreatedAt, &project.UpdatedAt); err != nil {
			return session, err
		}
		session.Project = &project
	}
	if err := parseAssetTimes(createdAt, updatedAt, &session.CreatedAt, &session.UpdatedAt); err != nil {
		return session, err
	}
	return session, nil
}

func applyOptionalSessionFields(session *model.Session, password, lastConnected sql.NullString) error {
	if password.Valid {
		session.Password = password.String
	}
	if !lastConnected.Valid {
		return nil
	}
	parsed, err := time.Parse("2006-01-02 15:04:05", lastConnected.String)
	if err != nil {
		return fmt.Errorf("parse last_connected_at: %w", err)
	}
	session.LastConnectedAt = &parsed
	return nil
}

func replaceSessionTags(tx *sql.Tx, sessionID int64, tagIDs []int64) error {
	if _, err := tx.Exec("DELETE FROM session_tags WHERE session_id = ?", sessionID); err != nil {
		return err
	}
	seen := make(map[int64]struct{}, len(tagIDs))
	for _, tagID := range tagIDs {
		if tagID <= 0 {
			return fmt.Errorf("invalid tag id %d", tagID)
		}
		if _, exists := seen[tagID]; exists {
			continue
		}
		seen[tagID] = struct{}{}
		if _, err := tx.Exec("INSERT INTO session_tags (session_id, tag_id) VALUES (?, ?)", sessionID, tagID); err != nil {
			return err
		}
	}
	return nil
}

func tagIDsFromAssets(tags []model.AssetTag) []int64 {
	ids := make([]int64, len(tags))
	for index, tag := range tags {
		ids[index] = tag.ID
	}
	return ids
}

func attachSessionTags(db *sql.DB, sessions []model.Session) error {
	if len(sessions) == 0 {
		return nil
	}
	placeholders := make([]string, len(sessions))
	arguments := make([]any, len(sessions))
	byID := make(map[int64]*model.Session, len(sessions))
	for index := range sessions {
		placeholders[index] = "?"
		arguments[index] = sessions[index].ID
		sessions[index].Tags = []model.AssetTag{}
		byID[sessions[index].ID] = &sessions[index]
	}
	query := `SELECT st.session_id, t.id, t.name, t.color_token, t.created_at, t.updated_at FROM session_tags st JOIN asset_tags t ON t.id = st.tag_id WHERE st.session_id IN (` + strings.Join(placeholders, ",") + `) ORDER BY t.name_key`
	rows, err := db.Query(query, arguments...)
	if err != nil {
		return fmt.Errorf("list session tags: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var sessionID int64
		var tag model.AssetTag
		var createdAt, updatedAt string
		if err := rows.Scan(&sessionID, &tag.ID, &tag.Name, &tag.ColorToken, &createdAt, &updatedAt); err != nil {
			return err
		}
		if err := parseAssetTimes(createdAt, updatedAt, &tag.CreatedAt, &tag.UpdatedAt); err != nil {
			return err
		}
		if session := byID[sessionID]; session != nil {
			session.Tags = append(session.Tags, tag)
		}
	}
	return rows.Err()
}

func ListRecentSessions(db *sql.DB, limit int) ([]model.Session, error) {
	if limit < 1 || limit > 10 {
		limit = 10
	}
	rows, err := db.Query(sessionSelectColumns+" FROM sessions s LEFT JOIN asset_environments e ON e.id = s.environment_id LEFT JOIN asset_projects p ON p.id = s.project_id WHERE s.last_connected_at IS NOT NULL ORDER BY s.last_connected_at DESC, s.id DESC LIMIT ?", limit)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := attachSessionTags(db, sessions); err != nil {
		return nil, err
	}
	return sessions, nil
}

func parseAssetTimes(createdAt, updatedAt string, created, updated *time.Time) error {
	var err error
	*created, err = time.Parse("2006-01-02 15:04:05", createdAt)
	if err != nil {
		return fmt.Errorf("parse asset created_at: %w", err)
	}
	*updated, err = time.Parse("2006-01-02 15:04:05", updatedAt)
	if err != nil {
		return fmt.Errorf("parse asset updated_at: %w", err)
	}
	return nil
}
