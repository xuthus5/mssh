package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	applicationProxyModeSetting     = "application.proxy_mode"
	applicationProxyURLSetting      = "application.proxy_url"
	applicationProxyNoProxySetting  = "application.proxy_no_proxy"
	applicationProxyUsernameSetting = "application.proxy_username"
	applicationProxyPasswordSetting = "application.proxy_password"
)

// ProxyConfigurer applies application HTTP proxy configuration.
type ProxyConfigurer interface {
	Configure(config netproxy.Config) error
	Config() netproxy.Config
}

func (s *SettingService) applyProxySettings(entries []model.Setting) error {
	if s.proxy == nil || len(entries) == 0 {
		return nil
	}
	// Detect whether any proxy-related key was written (including password_saved).
	changed := false
	for _, entry := range entries {
		switch entry.Key {
		case applicationProxyModeSetting, applicationProxyURLSetting, applicationProxyNoProxySetting,
			applicationProxyUsernameSetting, applicationProxyPasswordSetting, applicationProxyPasswordSavedSetting:
			changed = true
		}
	}
	if !changed {
		return nil
	}
	// Rebuild from storage so encrypted password is decrypted via loadProxyPassword.
	if err := s.proxy.Configure(s.currentProxyConfig()); err != nil {
		return fmt.Errorf("apply proxy settings: %w", err)
	}
	return nil
}

func (s *SettingService) resolveProxySettings(entries []model.Setting) (netproxy.Config, bool, error) {
	current := s.currentProxyConfig()
	changed, err := mergeProxySettingEntries(&current, entries)
	if err != nil || !changed {
		return netproxy.Config{}, false, err
	}
	current = netproxy.Normalize(current)
	if err := netproxy.Validate(current); err != nil {
		return netproxy.Config{}, false, err
	}
	return current, true, nil
}

func mergeProxySettingEntries(current *netproxy.Config, entries []model.Setting) (bool, error) {
	changed := false
	for _, entry := range entries {
		value, handled, err := decodeProxySettingEntry(entry)
		if err != nil {
			return false, err
		}
		if !handled {
			continue
		}
		applyProxySettingValue(current, entry.Key, value)
		changed = true
	}
	return changed, nil
}

func decodeProxySettingEntry(entry model.Setting) (string, bool, error) {
	switch entry.Key {
	case applicationProxyModeSetting, applicationProxyURLSetting, applicationProxyNoProxySetting,
		applicationProxyUsernameSetting, applicationProxyPasswordSetting:
		value, err := decodeSettingString(entry.Value)
		return value, true, err
	default:
		return "", false, nil
	}
}

func applyProxySettingValue(current *netproxy.Config, key, value string) {
	switch key {
	case applicationProxyModeSetting:
		current.Mode = netproxy.NormalizeMode(netproxy.Mode(value))
	case applicationProxyURLSetting:
		current.URL = value
	case applicationProxyNoProxySetting:
		current.NoProxy = value
	case applicationProxyUsernameSetting:
		current.Username = value
	case applicationProxyPasswordSetting:
		current.Password = value
	}
}

func (s *SettingService) currentProxyConfig() netproxy.Config {
	// Always rebuild from storage so cleared secrets do not stick in the live manager.
	config := netproxy.DefaultConfig()
	if mode, ok := s.readProxyString(applicationProxyModeSetting); ok {
		config.Mode = netproxy.NormalizeMode(netproxy.Mode(mode))
	}
	if value, ok := s.readProxyString(applicationProxyURLSetting); ok {
		config.URL = value
	}
	if value, ok := s.readProxyString(applicationProxyNoProxySetting); ok {
		config.NoProxy = value
	}
	if value, ok := s.readProxyString(applicationProxyUsernameSetting); ok {
		config.Username = value
	}
	if password, ok := s.loadProxyPassword(); ok {
		config.Password = password
	}
	return netproxy.Normalize(config)
}

func (s *SettingService) readProxyString(key string) (string, bool) {
	setting, err := store.GetSettingEntry(s.db, key)
	if err != nil || setting == nil {
		return "", false
	}
	value, err := decodeSettingString(setting.Value)
	if err != nil {
		return "", false
	}
	return value, true
}

// ApplyStoredProxySettings loads persisted proxy settings and applies them.
//
//wails:ignore
func (s *SettingService) ApplyStoredProxySettings() error {
	if s.proxy == nil {
		return nil
	}
	return s.proxy.Configure(s.currentProxyConfig())
}

func (s *SettingService) validateRuntimeSettings(entries []model.Setting) error {
	if _, _, err := s.resolveProxySettings(entries); err != nil {
		return err
	}
	if _, _, _, err := s.resolveLogSettings(entries); err != nil {
		return err
	}
	return validateLocalShellSettings(entries)
}
