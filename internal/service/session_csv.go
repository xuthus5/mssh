package service

import (
	"bytes"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	sessionCSVVersion  = "1"
	maxSessionCSVBytes = 10 << 20
	maxSessionCSVRows  = 10_000
)

var sessionCSVHeader = []string{
	"format_version", "name", "host", "port", "username", "auth_method", "password",
	"key_name", "key_public_key", "folder_path", "environment", "project", "tags", "notes",
	"keep_alive", "term_type",
}

type sessionCSVKey struct {
	Name      string
	PublicKey string
}

type sessionCSVRecord struct {
	Row          int
	Name         string
	Host         string
	Port         int
	Username     string
	AuthMethod   model.AuthMethod
	Password     string
	KeyName      string
	KeyPublicKey string
	FolderPath   []string
	Environment  string
	Project      string
	Tags         []string
	Notes        string
	KeepAlive    int
	TermType     string
}

func (s *SessionService) ExportCSV(path string, options model.SessionCSVExportOptions) (model.SessionCSVExportResult, error) {
	result := model.SessionCSVExportResult{IncludedPasswords: options.IncludePasswords}
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{
			Action: "export", TargetType: "session_csv", Summary: fmt.Sprintf("导出 %d 个 SSH 会话", result.Count), Outcome: outcome,
		})
	}()
	sessions, err := s.sessionsForCSV(options.SessionIDs)
	if err != nil {
		return result, fmt.Errorf("export session csv: %w", err)
	}
	folderPaths, err := loadSessionCSVFolderPaths(s.db)
	if err != nil {
		return result, fmt.Errorf("export session csv: %w", err)
	}
	keys, err := loadSessionCSVKeys(s.db)
	if err != nil {
		return result, fmt.Errorf("export session csv: %w", err)
	}
	content, err := encodeSessionCSV(sessions, folderPaths, keys, options.IncludePasswords)
	if err != nil {
		return result, fmt.Errorf("export session csv: %w", err)
	}
	if err := writePrivateFileAtomic(path, content); err != nil {
		return result, fmt.Errorf("export session csv: %w", err)
	}
	result.Count = len(sessions)
	outcome = "success"
	s.logger.Info("exported session csv", "count", result.Count, "includedPasswords", result.IncludedPasswords)
	return result, nil
}

func (s *SessionService) sessionsForCSV(ids []int64) ([]model.Session, error) {
	sessions, err := store.ListSessions(s.db, nil)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return sessions, nil
	}
	wanted := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, fmt.Errorf("invalid session id %d", id)
		}
		wanted[id] = struct{}{}
	}
	selected := make([]model.Session, 0, len(wanted))
	for _, session := range sessions {
		if _, exists := wanted[session.ID]; exists {
			selected = append(selected, session)
		}
	}
	if len(selected) != len(wanted) {
		return nil, errors.New("one or more sessions were not found")
	}
	return selected, nil
}

func encodeSessionCSV(sessions []model.Session, folderPaths map[int64][]string, keys map[int64]sessionCSVKey, includePasswords bool) ([]byte, error) {
	var buffer bytes.Buffer
	buffer.WriteString("\ufeff")
	writer := csv.NewWriter(&buffer)
	if err := writer.Write(sessionCSVHeader); err != nil {
		return nil, err
	}
	for _, session := range sessions {
		record, err := sessionCSVExportRecord(session, folderPaths, keys, includePasswords)
		if err != nil {
			return nil, err
		}
		if err := writer.Write(record); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func sessionCSVExportRecord(session model.Session, folderPaths map[int64][]string, keys map[int64]sessionCSVKey, includePasswords bool) ([]string, error) {
	folderPath := []string{}
	if session.FolderID != nil {
		folderPath = folderPaths[*session.FolderID]
	}
	tags := make([]string, len(session.Tags))
	for index, tag := range session.Tags {
		tags[index] = tag.Name
	}
	folderJSON, err := json.Marshal(folderPath)
	if err != nil {
		return nil, err
	}
	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		return nil, err
	}
	key := sessionCSVKey{}
	if session.KeyID != nil {
		key = keys[*session.KeyID]
	}
	password := ""
	if includePasswords {
		password = session.Password
	}
	return []string{
		sessionCSVVersion, protectCSVCell(session.Name), protectCSVCell(session.Host), strconv.Itoa(session.Port),
		protectCSVCell(session.Username), string(session.AuthMethod), protectCSVCell(password), protectCSVCell(key.Name),
		protectCSVCell(key.PublicKey), string(folderJSON), assetName(session.Environment), assetProjectName(session.Project),
		string(tagsJSON), protectCSVCell(session.Notes), strconv.Itoa(session.KeepAlive), protectCSVCell(session.TermType),
	}, nil
}

func loadSessionCSVFolderPaths(db *sql.DB) (map[int64][]string, error) {
	folders, err := store.ListFolders(db)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]model.SessionFolder, len(folders))
	for _, folder := range folders {
		byID[folder.ID] = folder
	}
	paths := make(map[int64][]string, len(folders))
	for _, folder := range folders {
		path, err := buildSessionCSVFolderPath(folder.ID, byID, map[int64]bool{})
		if err != nil {
			return nil, err
		}
		paths[folder.ID] = path
	}
	return paths, nil
}

func buildSessionCSVFolderPath(id int64, folders map[int64]model.SessionFolder, visiting map[int64]bool) ([]string, error) {
	folder, exists := folders[id]
	if !exists {
		return nil, fmt.Errorf("folder %d not found", id)
	}
	if visiting[id] {
		return nil, fmt.Errorf("folder cycle detected at %d", id)
	}
	visiting[id] = true
	path := []string{folder.Name}
	if folder.ParentID != nil {
		parent, err := buildSessionCSVFolderPath(*folder.ParentID, folders, visiting)
		if err != nil {
			return nil, err
		}
		path = append(parent, folder.Name)
	}
	delete(visiting, id)
	return path, nil
}

func loadSessionCSVKeys(db *sql.DB) (map[int64]sessionCSVKey, error) {
	rows, err := db.Query("SELECT id, name, public_key FROM ssh_keys")
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	keys := map[int64]sessionCSVKey{}
	for rows.Next() {
		var id int64
		var key sessionCSVKey
		if err := rows.Scan(&id, &key.Name, &key.PublicKey); err != nil {
			return nil, err
		}
		keys[id] = key
	}
	return keys, rows.Err()
}

func protectCSVCell(value string) string {
	if value == "" || !strings.ContainsRune("=+-@", rune(value[0])) {
		return value
	}
	return "'" + value
}

func restoreCSVCell(value string) string {
	if len(value) < 2 || value[0] != '\'' || !strings.ContainsRune("=+-@", rune(value[1])) {
		return value
	}
	return value[1:]
}

func assetName(value *model.AssetEnvironment) string {
	if value == nil {
		return ""
	}
	return protectCSVCell(value.Name)
}

func assetProjectName(value *model.AssetProject) string {
	if value == nil {
		return ""
	}
	return protectCSVCell(value.Name)
}
