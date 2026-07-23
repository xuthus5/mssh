package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/applog"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	applicationLogDirSetting       = "application.log_dir"
	applicationLogRetentionSetting = "application.log_retention_days"
)

// LogConfigurer applies application log directory and retention changes.
type LogConfigurer interface {
	Configure(dir string, retentionDays int) error
	Dir() string
	RetentionDays() int
}

func (s *SettingService) applyLogSettings(entries []model.Setting) error {
	if s.log == nil || len(entries) == 0 {
		return nil
	}
	dir, retention, changed, err := s.resolveLogSettings(entries)
	if err != nil || !changed {
		return err
	}
	if err := s.log.Configure(dir, retention); err != nil {
		return fmt.Errorf("apply log settings: %w", err)
	}
	return nil
}

func (s *SettingService) resolveLogSettings(entries []model.Setting) (string, int, bool, error) {
	dir := ""
	retention := 0
	dirChanged := false
	retentionChanged := false
	for _, entry := range entries {
		switch entry.Key {
		case applicationLogDirSetting:
			value, err := decodeSettingString(entry.Value)
			if err != nil {
				return "", 0, false, err
			}
			dir = value
			dirChanged = true
		case applicationLogRetentionSetting:
			value, err := decodeSettingInt(entry.Value)
			if err != nil {
				return "", 0, false, err
			}
			retention = value
			retentionChanged = true
		}
	}
	if !dirChanged && !retentionChanged {
		return "", 0, false, nil
	}
	if !dirChanged {
		dir = s.currentLogDir()
	}
	if !retentionChanged {
		retention = s.currentLogRetention()
	}
	validated, err := applog.ValidateDir(dir)
	if err != nil {
		return "", 0, false, err
	}
	return validated, applog.NormalizeRetentionDays(retention), true, nil
}

func (s *SettingService) currentLogDir() string {
	if setting, err := store.GetSettingEntry(s.db, applicationLogDirSetting); err == nil && setting != nil {
		if value, decodeErr := decodeSettingString(setting.Value); decodeErr == nil {
			return value
		}
	}
	if s.log != nil {
		return s.log.Dir()
	}
	return applog.DefaultDir()
}

func (s *SettingService) currentLogRetention() int {
	if setting, err := store.GetSettingEntry(s.db, applicationLogRetentionSetting); err == nil && setting != nil {
		if value, decodeErr := decodeSettingInt(setting.Value); decodeErr == nil {
			return value
		}
	}
	if s.log != nil {
		return s.log.RetentionDays()
	}
	return applog.DefaultRetentionDays
}

// ApplyStoredLogSettings loads persisted log settings and applies them to the log manager.
//
//wails:ignore
func (s *SettingService) ApplyStoredLogSettings() error {
	if s.log == nil {
		return nil
	}
	return s.log.Configure(s.currentLogDir(), s.currentLogRetention())
}

func decodeSettingString(raw string) (string, error) {
	var value string
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return "", fmt.Errorf("decode string setting: %w", err)
	}
	return strings.TrimSpace(value), nil
}

func decodeSettingInt(raw string) (int, error) {
	var value int
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return 0, fmt.Errorf("decode number setting: %w", err)
	}
	return value, nil
}
