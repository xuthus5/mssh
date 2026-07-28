package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	applicationProxyPasswordSavedSetting = "application.proxy_password_saved"
	proxyPasswordEncPrefix               = "enc1:"
)

// prepareProxyPasswordWrites rewrites proxy password entries for secure persistence.
// Empty password values are dropped (keep existing secret). JSON null writes an empty secret.
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
	if entry.ValueType == "null" {
		if strings.TrimSpace(entry.Value) != "null" {
			return nil, fmt.Errorf("invalid proxy password clear value")
		}
		return s.clearProxyPasswordSettings()
	}
	value, err := decodeExactSettingString(entry.Value)
	if err != nil {
		return nil, err
	}
	if value == "" {
		return nil, nil
	}
	return s.encryptedProxyPasswordSettings(entry, value)
}

func decodeExactSettingString(raw string) (string, error) {
	var value string
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return "", fmt.Errorf("decode exact string setting: %w", err)
	}
	return value, nil
}

func (s *SettingService) clearProxyPasswordSettings() ([]model.Setting, error) {
	saved, err := proxyPasswordSavedSetting(false)
	if err != nil {
		return nil, err
	}
	return []model.Setting{{
		Key: applicationProxyPasswordSetting, Namespace: "application", Value: `""`, ValueType: "string", Version: 1,
	}, saved}, nil
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
	sealed, err := encryptProxyPasswordValue(s.crypto, plaintext)
	if err != nil {
		return "", fmt.Errorf("encrypt proxy password: %w", err)
	}
	return sealed, nil
}

func (s *SettingService) decryptProxyPassword(raw string) (string, error) {
	plaintext, err := decryptProxyPasswordValue(s.crypto, raw)
	if err != nil {
		return "", fmt.Errorf("decrypt proxy password: %w", err)
	}
	return plaintext, nil
}

func (s *SettingService) loadProxyPassword() (string, bool, error) {
	raw, ok, err := s.readProxyString(applicationProxyPasswordSetting)
	if err != nil {
		return "", false, err
	}
	if !ok || raw == "" {
		return "", false, nil
	}
	password, err := s.decryptProxyPassword(raw)
	if err != nil {
		return "", false, err
	}
	return password, true, nil
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
