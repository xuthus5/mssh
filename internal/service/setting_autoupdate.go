package service

import (
	"encoding/json"
	"fmt"

	"github.com/xuthus5/mssh/internal/store"
)

const applicationAutoUpdateSetting = "application.auto_update"

// AutoUpdateEnabled reports whether the user enabled background updates.
//
//wails:ignore
func (s *SettingService) AutoUpdateEnabled() (bool, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return false, err
	}
	defer finish()
	setting, err := store.GetSettingEntry(s.db, applicationAutoUpdateSetting)
	if err != nil {
		return false, fmt.Errorf("load automatic update setting: %w", err)
	}
	if setting == nil {
		return false, nil
	}
	var enabled bool
	if err := json.Unmarshal([]byte(setting.Value), &enabled); err != nil {
		return false, fmt.Errorf("decode automatic update setting: %w", err)
	}
	return enabled, nil
}
