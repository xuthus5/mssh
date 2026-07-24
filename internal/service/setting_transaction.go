package service

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/store"
)

type settingSnapshot struct {
	values  map[string]model.Setting
	missing map[string]struct{}
}

type runtimeSettingsSnapshot struct {
	logDir       string
	logRetention int
	proxyConfig  netproxy.Config
	logChanged   bool
	proxyChanged bool
}

func (s *SettingService) persistAndApply(entries []model.Setting) error {
	if len(entries) == 0 {
		return nil
	}
	previous, err := captureSettingSnapshot(s.db, entries)
	if err != nil {
		return err
	}
	runtimeSnapshot := captureRuntimeSettings(s, entries)
	if err := store.SetSettings(s.db, entries); err != nil {
		return err
	}
	if err := s.applyLogSettings(entries); err != nil {
		return s.rollbackSettingChange(previous, runtimeSnapshot, err)
	}
	if err := s.applyProxySettings(entries); err != nil {
		return s.rollbackSettingChange(previous, runtimeSnapshot, err)
	}
	return nil
}

func captureSettingSnapshot(db *sql.DB, entries []model.Setting) (settingSnapshot, error) {
	snapshot := settingSnapshot{values: make(map[string]model.Setting), missing: make(map[string]struct{})}
	for _, entry := range entries {
		if _, seen := snapshot.values[entry.Key]; seen {
			continue
		}
		if _, seen := snapshot.missing[entry.Key]; seen {
			continue
		}
		previous, err := store.GetSettingEntry(db, entry.Key)
		if err != nil {
			return settingSnapshot{}, fmt.Errorf("capture setting %s: %w", entry.Key, err)
		}
		if previous == nil {
			snapshot.missing[entry.Key] = struct{}{}
			continue
		}
		snapshot.values[entry.Key] = *previous
	}
	return snapshot, nil
}

func captureRuntimeSettings(service *SettingService, entries []model.Setting) runtimeSettingsSnapshot {
	snapshot := runtimeSettingsSnapshot{}
	for _, entry := range entries {
		switch entry.Key {
		case applicationLogDirSetting, applicationLogRetentionSetting:
			snapshot.logChanged = true
		case applicationProxyModeSetting, applicationProxyURLSetting, applicationProxyNoProxySetting,
			applicationProxyUsernameSetting, applicationProxyPasswordSetting, applicationProxyPasswordSavedSetting:
			snapshot.proxyChanged = true
		}
	}
	if snapshot.logChanged && service.log != nil {
		snapshot.logDir = service.log.Dir()
		snapshot.logRetention = service.log.RetentionDays()
	}
	if snapshot.proxyChanged && service.proxy != nil {
		snapshot.proxyConfig = service.proxy.Config()
	}
	return snapshot
}

func (s *SettingService) rollbackSettingChange(previous settingSnapshot, runtimeSnapshot runtimeSettingsSnapshot, cause error) error {
	errorsToReport := []error{cause}
	if err := restoreSettingSnapshot(s.db, previous); err != nil {
		errorsToReport = append(errorsToReport, err)
	}
	if runtimeSnapshot.logChanged && s.log != nil {
		if err := s.log.Configure(runtimeSnapshot.logDir, runtimeSnapshot.logRetention); err != nil {
			errorsToReport = append(errorsToReport, fmt.Errorf("restore log settings: %w", err))
		}
	}
	if runtimeSnapshot.proxyChanged && s.proxy != nil {
		if err := s.proxy.Configure(runtimeSnapshot.proxyConfig); err != nil {
			errorsToReport = append(errorsToReport, fmt.Errorf("restore proxy settings: %w", err))
		}
	}
	return errors.Join(errorsToReport...)
}

func restoreSettingSnapshot(db *sql.DB, snapshot settingSnapshot) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin setting rollback: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for key, setting := range snapshot.values {
		if err := store.SetSettingsTx(tx, []model.Setting{setting}); err != nil {
			return fmt.Errorf("restore setting %s: %w", key, err)
		}
	}
	for key := range snapshot.missing {
		if _, err := tx.Exec("DELETE FROM settings WHERE key = ?", key); err != nil {
			return fmt.Errorf("remove setting %s: %w", key, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit setting rollback: %w", err)
	}
	return nil
}
