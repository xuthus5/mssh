package service

import (
	"database/sql"
	"log/slog"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type SettingService struct {
	db *sql.DB
}

func (s *SettingService) Get(key string) (*model.Setting, error) {
	if err := rejectBlockedSettingKey(key); err != nil {
		return nil, err
	}
	return store.GetSettingEntry(s.db, key)
}

func (s *SettingService) GetMany(keys []string) (map[string]model.Setting, error) {
	for _, key := range keys {
		if err := rejectBlockedSettingKey(key); err != nil {
			return nil, err
		}
	}
	settings, err := store.GetSettings(s.db, keys)
	if err != nil {
		return nil, err
	}
	return filterBlockedSettings(settings), nil
}

func (s *SettingService) List(namespace string) ([]model.Setting, error) {
	settings, err := store.ListSettings(s.db, namespace)
	if err != nil {
		return nil, err
	}
	filtered := make([]model.Setting, 0, len(settings))
	for _, setting := range settings {
		if settingBlocked(setting.Key) {
			continue
		}
		filtered = append(filtered, setting)
	}
	return filtered, nil
}

func (s *SettingService) Set(setting model.SettingInput) error {
	entry := setting.Setting()
	if err := rejectBlockedSettingKey(entry.Key); err != nil {
		return err
	}
	return store.SetSettings(s.db, []model.Setting{entry})
}

func (s *SettingService) SetMany(settings []model.SettingInput) error {
	entries := make([]model.Setting, len(settings))
	for index, setting := range settings {
		entries[index] = setting.Setting()
	}
	if err := rejectBlockedSettings(entries); err != nil {
		return err
	}
	return store.SetSettings(s.db, entries)
}

func (s *SettingService) Delete(key string) error { return store.DeleteSetting(s.db, key) }

func NewSettingService(db *sql.DB, _ *slog.Logger) *SettingService {
	return &SettingService{db: db}
}
