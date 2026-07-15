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
	return store.GetSettingEntry(s.db, key)
}

func (s *SettingService) GetMany(keys []string) (map[string]model.Setting, error) {
	return store.GetSettings(s.db, keys)
}

func (s *SettingService) List(namespace string) ([]model.Setting, error) {
	return store.ListSettings(s.db, namespace)
}

func (s *SettingService) Set(setting model.SettingInput) error {
	return store.SetSettings(s.db, []model.Setting{setting.Setting()})
}

func (s *SettingService) SetMany(settings []model.SettingInput) error {
	entries := make([]model.Setting, len(settings))
	for index, setting := range settings {
		entries[index] = setting.Setting()
	}
	return store.SetSettings(s.db, entries)
}

func (s *SettingService) Delete(key string) error { return store.DeleteSetting(s.db, key) }

func NewSettingService(db *sql.DB, _ *slog.Logger) *SettingService {
	return &SettingService{db: db}
}
