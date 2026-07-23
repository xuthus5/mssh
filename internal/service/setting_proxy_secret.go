package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	applicationProxyPasswordSavedSetting = "application.proxy_password_saved"
	proxyPasswordClearSentinel           = "__clear_proxy_password__"
	proxyPasswordEncPrefix               = "enc1:"
)

// prepareProxyPasswordWrites rewrites proxy password entries for secure persistence.
// Empty password values are dropped (keep existing secret). The clear sentinel deletes the secret.
func (s *SettingService) prepareProxyPasswordWrites(entries []model.Setting) ([]model.Setting, error) {
	out := make([]model.Setting, 0, len(entries)+1)
	for _, entry := range entries {
		if entry.Key != applicationProxyPasswordSetting {
			out = append(out, entry)
			continue
		}
		rewritten, err := s.rewriteProxyPasswordEntry(entry)
		if err != nil {
			return nil, err
		}
		out = append(out, rewritten...)
	}
	return out, nil
}

func (s *SettingService) rewriteProxyPasswordEntry(entry model.Setting) ([]model.Setting, error) {
	value, err := decodeSettingString(entry.Value)
	if err != nil {
		return nil, err
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if value == proxyPasswordClearSentinel {
		return s.clearProxyPasswordSettings()
	}
	return s.encryptedProxyPasswordSettings(entry, value)
}

func (s *SettingService) clearProxyPasswordSettings() ([]model.Setting, error) {
	if err := store.DeleteSetting(s.db, applicationProxyPasswordSetting); err != nil {
		return nil, fmt.Errorf("clear proxy password: %w", err)
	}
	saved, err := proxyPasswordSavedSetting(false)
	if err != nil {
		return nil, err
	}
	return []model.Setting{saved}, nil
}

func (s *SettingService) encryptedProxyPasswordSettings(entry model.Setting, plaintext string) ([]model.Setting, error) {
	encrypted, err := s.encryptProxyPassword(plaintext)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(encrypted)
	if err != nil {
		return nil, err
	}
	password := model.Setting{
		Key: applicationProxyPasswordSetting, Namespace: entry.Namespace,
		Value: string(payload), ValueType: "string", Version: entry.Version,
	}
	saved, err := proxyPasswordSavedSetting(true)
	if err != nil {
		return nil, err
	}
	return []model.Setting{password, saved}, nil
}

func proxyPasswordSavedSetting(saved bool) (model.Setting, error) {
	payload, err := json.Marshal(saved)
	if err != nil {
		return model.Setting{}, err
	}
	return model.Setting{
		Key: applicationProxyPasswordSavedSetting, Namespace: "application",
		Value: string(payload), ValueType: "boolean", Version: 1,
	}, nil
}

func (s *SettingService) encryptProxyPassword(plaintext string) (string, error) {
	if s.crypto == nil {
		return "", fmt.Errorf("proxy password encryption is unavailable")
	}
	encrypted, err := s.crypto.Encrypt([]byte(plaintext))
	if err != nil {
		return "", fmt.Errorf("encrypt proxy password: %w", err)
	}
	return proxyPasswordEncPrefix + string(encrypted), nil
}

func (s *SettingService) decryptProxyPassword(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	// Legacy plaintext passwords remain usable until the next save.
	if !strings.HasPrefix(raw, proxyPasswordEncPrefix) {
		return raw, nil
	}
	if s.crypto == nil {
		return "", fmt.Errorf("proxy password decryption is unavailable")
	}
	plaintext, err := s.crypto.Decrypt([]byte(strings.TrimPrefix(raw, proxyPasswordEncPrefix)))
	if err != nil {
		return "", fmt.Errorf("decrypt proxy password: %w", err)
	}
	return string(plaintext), nil
}

func (s *SettingService) loadProxyPassword() (string, bool) {
	raw, ok := s.readProxyString(applicationProxyPasswordSetting)
	if !ok || raw == "" {
		return "", false
	}
	password, err := s.decryptProxyPassword(raw)
	if err != nil {
		return "", true
	}
	return password, true
}

func redactProxyPasswordSetting(setting *model.Setting) {
	if setting == nil || setting.Key != applicationProxyPasswordSetting {
		return
	}
	setting.Value = `""`
}

func redactProxyPasswordSettings(settings map[string]model.Setting) {
	if settings == nil {
		return
	}
	entry, ok := settings[applicationProxyPasswordSetting]
	if !ok {
		return
	}
	entry.Value = `""`
	settings[applicationProxyPasswordSetting] = entry
	if _, hasSaved := settings[applicationProxyPasswordSavedSetting]; hasSaved {
		return
	}
	saved, err := proxyPasswordSavedSetting(true)
	if err != nil {
		return
	}
	settings[applicationProxyPasswordSavedSetting] = saved
}
