package service

import (
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

// Settings that must never pass through the generic SettingService surface.
// Secrets are owned by SecurityService / SyncService vault-backed APIs.
var blockedGenericSettingKeys = map[string]struct{}{
	"sync.master_key":             {},
	"sync.secret.gist_token":      {},
	"sync.secret.webdav_password": {},
	"sync.secret.s3_secret_key":   {},
}

func settingBlocked(key string) bool {
	if _, blocked := blockedGenericSettingKeys[key]; blocked {
		return true
	}
	if strings.Contains(key, ".secret.") {
		return true
	}
	if strings.HasSuffix(key, ".master_key") || strings.HasSuffix(key, ".password") || strings.HasSuffix(key, ".token") {
		return true
	}
	return false
}

func rejectBlockedSettingKey(key string) error {
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("setting key is required")
	}
	if settingBlocked(key) {
		return fmt.Errorf("setting %q cannot be accessed through the generic settings API", key)
	}
	return nil
}

func rejectBlockedSettings(settings []model.Setting) error {
	for _, setting := range settings {
		if err := rejectBlockedSettingKey(setting.Key); err != nil {
			return err
		}
	}
	return nil
}

func filterBlockedSettings(settings map[string]model.Setting) map[string]model.Setting {
	if len(settings) == 0 {
		return settings
	}
	filtered := make(map[string]model.Setting, len(settings))
	for key, setting := range settings {
		if settingBlocked(key) {
			continue
		}
		filtered[key] = setting
	}
	return filtered
}
