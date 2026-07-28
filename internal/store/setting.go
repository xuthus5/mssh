package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const settingsTableSQL = `CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	namespace TEXT NOT NULL,
	value TEXT NOT NULL,
	value_type TEXT NOT NULL CHECK(value_type IN ('string','number','boolean','array','object','null')),
	version INTEGER NOT NULL DEFAULT 1,
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

func GetSettingEntry(db *sql.DB, key string) (*model.Setting, error) {
	if err := ValidateSettingKey(key); err != nil {
		return nil, err
	}
	setting, err := scanSetting(db.QueryRow("SELECT key, namespace, value, value_type, version, updated_at FROM settings WHERE key = ?", key))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get setting: %w", err)
	}
	return &setting, nil
}

func GetSettings(db *sql.DB, keys []string) (map[string]model.Setting, error) {
	if err := ValidateSettingKeys(keys); err != nil {
		return nil, err
	}
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
	if err := ValidateSettingNamespace(namespace); err != nil {
		return nil, err
	}
	rows, err := db.Query("SELECT key, namespace, value, value_type, version, updated_at FROM settings WHERE namespace = ? ORDER BY key", namespace)
	if err != nil {
		return nil, fmt.Errorf("list settings: %w", err)
	}
	defer func() { _ = rows.Close() }()
	settings := make([]model.Setting, 0)
	for rows.Next() {
		setting, err := scanSetting(rows)
		if err != nil {
			return nil, fmt.Errorf("list settings: %w", err)
		}
		settings = append(settings, setting)
	}
	return settings, rows.Err()
}

func SetSettings(db *sql.DB, settings []model.Setting) error {
	if err := validateSettings(settings); err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("set settings: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := setSettings(tx, settings); err != nil {
		return err
	}
	return tx.Commit()
}

// SetSettingsTx writes settings inside a caller-owned transaction.
func SetSettingsTx(tx *sql.Tx, settings []model.Setting) error {
	if tx == nil {
		return fmt.Errorf("set settings: transaction is required")
	}
	if err := validateSettings(settings); err != nil {
		return err
	}
	return setSettings(tx, settings)
}

func setSettings(tx *sql.Tx, settings []model.Setting) error {
	for _, setting := range settings {
		_, err := tx.Exec(`INSERT INTO settings (key, namespace, value, value_type, version, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET namespace=excluded.namespace, value=excluded.value, value_type=excluded.value_type, version=excluded.version, updated_at=datetime('now')`, setting.Key, setting.Namespace, setting.Value, setting.ValueType, setting.Version)
		if err != nil {
			return fmt.Errorf("set settings: %w", err)
		}
	}
	return nil
}

func DeleteSetting(db *sql.DB, key string) error {
	if err := ValidateSettingKey(key); err != nil {
		return err
	}
	if _, err := db.Exec("DELETE FROM settings WHERE key = ?", key); err != nil {
		return fmt.Errorf("delete setting: %w", err)
	}
	return nil
}

type settingScanner interface {
	Scan(dest ...any) error
}

func scanSetting(scanner settingScanner) (model.Setting, error) {
	var setting model.Setting
	var updatedAt string
	if err := scanner.Scan(&setting.Key, &setting.Namespace, &setting.Value, &setting.ValueType, &setting.Version, &updatedAt); err != nil {
		return model.Setting{}, err
	}
	parsedUpdatedAt, err := time.Parse("2006-01-02 15:04:05", updatedAt)
	if err != nil {
		return model.Setting{}, fmt.Errorf("parse updated_at: %w", err)
	}
	setting.UpdatedAt = parsedUpdatedAt
	if err := validateSetting(setting); err != nil {
		return model.Setting{}, err
	}
	return setting, nil
}
