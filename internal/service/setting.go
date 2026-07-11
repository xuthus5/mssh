package service

import (
	"database/sql"
	"log/slog"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type SettingService struct {
	db     *sql.DB
	logger *slog.Logger
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

func (s *SettingService) Set(setting model.Setting) error {
	return store.SetSettings(s.db, []model.Setting{setting})
}

func (s *SettingService) SetMany(settings []model.Setting) error {
	return store.SetSettings(s.db, settings)
}

func (s *SettingService) Delete(key string) error { return store.DeleteSetting(s.db, key) }

func NewSettingService(db *sql.DB, logger *slog.Logger) *SettingService {
	return &SettingService{db: db, logger: logger}
}

func (s *SettingService) GetSetting(key string) (string, error) {
	s.logger.Info("getting setting", "key", key)
	return store.GetSetting(s.db, key)
}

func (s *SettingService) SetSetting(key, value string) error {
	s.logger.Info("setting setting", "key", key, "value", value)
	return store.SetSetting(s.db, key, value)
}
