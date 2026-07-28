package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"

	"github.com/google/uuid"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SyncService) secretSaved(key string) bool {
	var raw string
	return s.db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&raw) == nil && raw != ""
}

func (s *SyncService) deviceID() (string, error) {
	var value string
	if err := readSyncSetting(s.db, syncDeviceIDSetting, &value); err == nil && value != "" {
		return value, nil
	}
	value = uuid.NewString()
	if err := writeSyncSetting(s.db, syncDeviceIDSetting, value); err != nil {
		return "", err
	}
	return value, nil
}

func writeSyncSetting(db *sql.DB, key string, value any) error {
	setting, err := buildSyncSetting(key, value)
	if err != nil {
		return err
	}
	return store.SetSettings(db, []model.Setting{setting})
}

func readSyncSetting(db *sql.DB, key string, value any) error {
	setting, err := store.GetSettingEntry(db, key)
	if err != nil {
		return err
	}
	if setting == nil {
		return sql.ErrNoRows
	}
	if err := json.Unmarshal([]byte(setting.Value), value); err != nil {
		return fmt.Errorf("decode sync setting %s: %w", key, err)
	}
	return nil
}

func syncSettingType(value any) string {
	switch value.(type) {
	case string:
		return "string"
	case bool:
		return "boolean"
	case int, int64:
		return "number"
	default:
		return "object"
	}
}

func syncVersionPath(dataDir, fileName string) string {
	return filepath.Join(dataDir, "sync", "versions", fileName)
}

func (s *SyncService) syncHTTPClient() *http.Client {
	return sharedHTTPClient(syncNetworkTimeout, s.proxyManager)
}

func syncHTTPClient() *http.Client {
	return sharedHTTPClient(syncNetworkTimeout, nil)
}
