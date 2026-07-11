package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const settingsTableSQL = `CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	namespace TEXT NOT NULL,
	value TEXT NOT NULL,
	value_type TEXT NOT NULL CHECK(value_type IN ('string','number','boolean','array','object','null')),
	version INTEGER NOT NULL DEFAULT 1,
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

func ensureSettingsSchema(db *sql.DB) error {
	var tableSQL string
	err := db.QueryRow("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'settings'").Scan(&tableSQL)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == nil && strings.Contains(tableSQL, "namespace") && strings.Contains(tableSQL, "value_type") {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec("DROP TABLE IF EXISTS settings"); err != nil {
		return err
	}
	if _, err := tx.Exec(settingsTableSQL); err != nil {
		return err
	}
	return tx.Commit()
}

func GetSettingEntry(db *sql.DB, key string) (*model.Setting, error) {
	var setting model.Setting
	var updatedAt string
	err := db.QueryRow("SELECT key, namespace, value, value_type, version, updated_at FROM settings WHERE key = ?", key).Scan(&setting.Key, &setting.Namespace, &setting.Value, &setting.ValueType, &setting.Version, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get setting: %w", err)
	}
	setting.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", updatedAt)
	if err != nil {
		return nil, fmt.Errorf("get setting: parse updated_at: %w", err)
	}
	return &setting, nil
}

func GetSettings(db *sql.DB, keys []string) (map[string]model.Setting, error) {
	result := make(map[string]model.Setting, len(keys))
	for _, key := range keys {
		setting, err := GetSettingEntry(db, key)
		if err != nil {
			return nil, err
		}
		if setting != nil {
			result[key] = *setting
		}
	}
	return result, nil
}

func ListSettings(db *sql.DB, namespace string) ([]model.Setting, error) {
	rows, err := db.Query("SELECT key, namespace, value, value_type, version, updated_at FROM settings WHERE namespace = ? ORDER BY key", namespace)
	if err != nil {
		return nil, fmt.Errorf("list settings: %w", err)
	}
	defer func() { _ = rows.Close() }()
	settings := make([]model.Setting, 0)
	for rows.Next() {
		var setting model.Setting
		var updatedAt string
		if err := rows.Scan(&setting.Key, &setting.Namespace, &setting.Value, &setting.ValueType, &setting.Version, &updatedAt); err != nil {
			return nil, fmt.Errorf("list settings: %w", err)
		}
		setting.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", updatedAt)
		if err != nil {
			return nil, fmt.Errorf("list settings: parse updated_at: %w", err)
		}
		settings = append(settings, setting)
	}
	return settings, rows.Err()
}

func SetSettings(db *sql.DB, settings []model.Setting) error {
	for _, setting := range settings {
		if err := validateSetting(setting); err != nil {
			return err
		}
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("set settings: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, setting := range settings {
		_, err := tx.Exec(`INSERT INTO settings (key, namespace, value, value_type, version, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET namespace=excluded.namespace, value=excluded.value, value_type=excluded.value_type, version=excluded.version, updated_at=datetime('now')`, setting.Key, setting.Namespace, setting.Value, setting.ValueType, setting.Version)
		if err != nil {
			return fmt.Errorf("set settings: %w", err)
		}
	}
	return tx.Commit()
}

func DeleteSetting(db *sql.DB, key string) error {
	if _, err := db.Exec("DELETE FROM settings WHERE key = ?", key); err != nil {
		return fmt.Errorf("delete setting: %w", err)
	}
	return nil
}

func validateSetting(setting model.Setting) error {
	if setting.Key == "" || setting.Namespace == "" || (setting.Namespace != "legacy" && !strings.HasPrefix(setting.Key, setting.Namespace+".")) {
		return fmt.Errorf("invalid setting key or namespace")
	}
	if setting.Version < 1 {
		return fmt.Errorf("invalid setting version")
	}
	if !json.Valid([]byte(setting.Value)) {
		return fmt.Errorf("invalid setting JSON")
	}
	validTypes := map[string]bool{"string": true, "number": true, "boolean": true, "array": true, "object": true, "null": true}
	if !validTypes[setting.ValueType] {
		return fmt.Errorf("invalid setting value type")
	}
	return nil
}

func GetSetting(db *sql.DB, key string) (string, error) {
	setting, err := GetSettingEntry(db, key)
	if err != nil || setting == nil {
		return "", err
	}
	var value string
	if err := json.Unmarshal([]byte(setting.Value), &value); err == nil {
		return value, nil
	}
	return setting.Value, nil
}

func SetSetting(db *sql.DB, key, value string) error {
	namespace := "legacy"
	if strings.Contains(key, ".") {
		namespace = strings.SplitN(key, ".", 2)[0]
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return SetSettings(db, []model.Setting{{Key: key, Namespace: namespace, Value: string(encoded), ValueType: "string", Version: 1}})
}
