package service

import (
	"database/sql"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SyncService) persistSyncConfig(input model.SyncConfigInput, previous, config model.SyncConfig) error {
	changes, err := s.prepareInputSecrets(input)
	if err != nil {
		return err
	}
	configSetting, err := buildSyncSetting(syncConfigSetting, config)
	if err != nil {
		return err
	}
	changes.settings = append(changes.settings, configSetting)
	return s.commitSyncConfig(changes, previous, config)
}

func (s *SyncService) commitSyncConfig(changes syncSecretChanges, previous, config model.SyncConfig) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin sync config update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := applySyncConfigChangesTx(tx, changes, previous, config); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit sync config update: %w", err)
	}
	return nil
}

func applySyncConfigChangesTx(tx *sql.Tx, changes syncSecretChanges, previous, config model.SyncConfig) error {
	if err := store.SetSettingsTx(tx, changes.settings); err != nil {
		return err
	}
	if err := deleteSyncSettingsTx(tx, changes.deletes); err != nil {
		return err
	}
	if providerChanged(previous, config) {
		if _, err := tx.Exec("DELETE FROM settings WHERE key = ?", syncBaselineSetting(config.Provider)); err != nil {
			return fmt.Errorf("clear sync baseline: %w", err)
		}
	}
	return nil
}

func deleteSyncSettingsTx(tx *sql.Tx, keys []string) error {
	for _, key := range keys {
		if _, err := tx.Exec("DELETE FROM settings WHERE key = ?", key); err != nil {
			return fmt.Errorf("delete sync setting %s: %w", key, err)
		}
	}
	return nil
}

func providerChanged(previous, current model.SyncConfig) bool {
	return previous.Provider != current.Provider || providerIdentity(previous) != providerIdentity(current)
}
