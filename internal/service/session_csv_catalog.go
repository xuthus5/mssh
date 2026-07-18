package service

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

func resolveSessionCSVFolder(tx *sql.Tx, path []string) (int64, error) {
	if len(path) == 0 {
		var id int64
		if err := tx.QueryRow("SELECT id FROM session_folders WHERE is_default=1").Scan(&id); err != nil {
			return 0, fmt.Errorf("resolve default folder: %w", err)
		}
		return id, nil
	}
	var parentID *int64
	for _, rawName := range path {
		name := strings.TrimSpace(rawName)
		id, err := findOrCreateSessionCSVFolder(tx, name, parentID)
		if err != nil {
			return 0, err
		}
		parentID = &id
	}
	return *parentID, nil
}

func findOrCreateSessionCSVFolder(tx *sql.Tx, name string, parentID *int64) (int64, error) {
	var id int64
	var err error
	if parentID == nil {
		err = tx.QueryRow("SELECT id FROM session_folders WHERE name=? AND parent_id IS NULL ORDER BY id LIMIT 1", name).Scan(&id)
	} else {
		err = tx.QueryRow("SELECT id FROM session_folders WHERE name=? AND parent_id=? ORDER BY id LIMIT 1", name, *parentID).Scan(&id)
	}
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("find folder %q: %w", name, err)
	}
	result, err := tx.Exec("INSERT INTO session_folders (name, parent_id) VALUES (?, ?)", name, parentID)
	if err != nil {
		return 0, fmt.Errorf("create folder %q: %w", name, err)
	}
	id, err = result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("create folder %q id: %w", name, err)
	}
	return id, nil
}

func resolveSessionCSVAsset(tx *sql.Tx, kind, rawName string) (*int64, error) {
	if rawName == "" {
		return nil, nil
	}
	name, key, err := normalizeAssetName(rawName, 64)
	if err != nil {
		return nil, err
	}
	selectQuery, insert := sessionCSVAssetQueries(kind)
	var id int64
	err = tx.QueryRow(selectQuery, key).Scan(&id)
	if err == nil {
		return &id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("find %s: %w", kind, err)
	}
	result, err := tx.Exec(insert, name, key)
	if err != nil {
		return nil, fmt.Errorf("create %s: %w", kind, err)
	}
	id, err = result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("create %s id: %w", kind, err)
	}
	return &id, nil
}

func sessionCSVAssetQueries(kind string) (string, string) {
	if kind == "project" {
		return "SELECT id FROM asset_projects WHERE name_key=?", "INSERT INTO asset_projects (name, name_key, code, code_key, description) VALUES (?, ?, '', NULL, '')"
	}
	return "SELECT id FROM asset_environments WHERE name_key=?", "INSERT INTO asset_environments (name, name_key, color_token) VALUES (?, ?, 'slate')"
}

func resolveSessionCSVTags(tx *sql.Tx, values []string) ([]int64, error) {
	ids := make([]int64, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		name, key, err := normalizeAssetName(value, 32)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		id, err := findOrCreateSessionCSVTag(tx, name, key)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func findOrCreateSessionCSVTag(tx *sql.Tx, name, key string) (int64, error) {
	var id int64
	err := tx.QueryRow("SELECT id FROM asset_tags WHERE name_key=?", key).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("find tag: %w", err)
	}
	result, err := tx.Exec("INSERT INTO asset_tags (name, name_key, color_token) VALUES (?, ?, 'slate')", name, key)
	if err != nil {
		return 0, fmt.Errorf("create tag: %w", err)
	}
	id, err = result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("create tag id: %w", err)
	}
	return id, nil
}

func resolveSessionCSVKey(tx *sql.Tx, record sessionCSVRecord) (*int64, error) {
	if record.AuthMethod != model.AuthKey {
		return nil, nil
	}
	if record.KeyPublicKey != "" {
		id, found, err := uniqueSessionCSVKey(tx, "public_key", record.KeyPublicKey)
		if err != nil || found {
			return id, err
		}
	}
	if record.KeyName == "" {
		return nil, errors.New("key authentication requires key_name or key_public_key")
	}
	id, found, err := uniqueSessionCSVKey(tx, "name", record.KeyName)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("key %q was not found", record.KeyName)
	}
	return id, nil
}

func uniqueSessionCSVKey(tx *sql.Tx, column, value string) (*int64, bool, error) {
	query := "SELECT id FROM ssh_keys WHERE name=? ORDER BY id LIMIT 2"
	if column == "public_key" {
		query = "SELECT id FROM ssh_keys WHERE public_key=? ORDER BY id LIMIT 2"
	}
	rows, err := tx.Query(query, value)
	if err != nil {
		return nil, false, fmt.Errorf("find key: %w", err)
	}
	defer func() { _ = rows.Close() }()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, false, fmt.Errorf("find key: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("find key: %w", err)
	}
	if len(ids) > 1 {
		return nil, false, fmt.Errorf("key %s is ambiguous", column)
	}
	if len(ids) == 0 {
		return nil, false, nil
	}
	return &ids[0], true, nil
}
