package service

import (
	"encoding/json"
	"fmt"

	"github.com/xuthus5/mssh/internal/store"
)

const webviewGpuSetting = "application.webview_gpu"

// WebviewGpu reports the persisted Linux webview hardware acceleration policy
// ("always" or "never", default "never"). The policy is applied when the webview
// window is created, so changes take effect on the next app launch.
//
//wails:ignore
func (s *SettingService) WebviewGpu() (string, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return "", err
	}
	defer finish()
	setting, err := store.GetSettingEntry(s.db, webviewGpuSetting)
	if err != nil {
		return "", fmt.Errorf("load webview gpu setting: %w", err)
	}
	if setting == nil {
		return "never", nil
	}
	var value string
	if err := json.Unmarshal([]byte(setting.Value), &value); err != nil {
		return "", fmt.Errorf("decode webview gpu setting: %w", err)
	}
	if value != "always" {
		return "never", nil
	}
	return "always", nil
}
