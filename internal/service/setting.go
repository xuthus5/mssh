package service

import (
	"database/sql"
	"log/slog"

	"github.com/xuthus5/mssh/internal/store"
)

type SettingService struct {
	db     *sql.DB
	logger *slog.Logger
}

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
