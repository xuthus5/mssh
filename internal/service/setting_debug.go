package service

import (
	"encoding/json"
	"fmt"

	"github.com/xuthus5/mssh/internal/store"
)

const applicationDebugSetting = "application.debug"

// ApplicationDebugEnabled reports whether the application debug (developer
// tools) setting is enabled. It returns false when the setting is absent.
//
//wails:ignore
func (s *SettingService) ApplicationDebugEnabled() (bool, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return false, err
	}
	defer finish()
	setting, err := store.GetSettingEntry(s.db, applicationDebugSetting)
	if err != nil {
		return false, fmt.Errorf("load application debug setting: %w", err)
	}
	if setting == nil {
		return false, nil
	}
	var enabled bool
	if err := json.Unmarshal([]byte(setting.Value), &enabled); err != nil {
		return false, fmt.Errorf("decode application debug setting: %w", err)
	}
	return enabled, nil
}
