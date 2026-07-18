package service

import (
	"errors"
	"fmt"
	"os"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const syncDataChangedEvent = "sync:data-changed"

type syncLifecycle interface {
	PrepareDestructiveSync() error
}

func (s *SyncService) RestoreVersion(id int64) error {
	config, err := s.LoadConfig()
	if err != nil {
		return err
	}
	version, err := store.GetSyncVersion(s.db, id)
	if err != nil {
		return err
	}
	if version == nil {
		return errors.New("sync version not found")
	}
	content, err := os.ReadFile(s.versionFilePath(*version))
	if err != nil {
		return fmt.Errorf("read sync version: %w", err)
	}
	masterKey, err := s.masterKey()
	if err != nil {
		return err
	}
	artifact, err := decodeSyncArtifact(content, masterKey)
	if err != nil {
		return err
	}
	if err := validateSnapshot(s.db, artifact.Data); err != nil {
		return err
	}
	if err := s.prepareDestructiveSync(config, "pre-restore"); err != nil {
		return err
	}
	if err := s.restore(artifact.Data); err != nil {
		return err
	}
	s.markPending("已恢复本地版本，等待同步")
	s.recordSyncEvent("restore", config, model.SyncEventSuccess, version.ID, version.VersionNumber, "已恢复本地版本")
	s.notifyDataChanged()
	return nil
}

func (s *SyncService) ResetLocalData() error {
	config, err := s.LoadConfig()
	if err != nil {
		return err
	}
	if err := s.prepareDestructiveSync(config, "pre-reset"); err != nil {
		return err
	}
	if err := s.clearSynchronizedData(); err != nil {
		return err
	}
	s.markPending("本地业务数据已清空，等待同步")
	s.recordSyncEvent("reset", config, model.SyncEventSuccess, 0, 0, "已清空本地业务数据")
	s.notifyDataChanged()
	return nil
}

func (s *SyncService) prepareDestructiveSync(config model.SyncConfig, source string) error {
	if s.lifecycle != nil {
		if err := s.lifecycle.PrepareDestructiveSync(); err != nil {
			return err
		}
	}
	_, err := s.saveCurrentVersion(config.Provider, source, true)
	return err
}

func (s *SyncService) clearSynchronizedData() error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin sync reset: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec("UPDATE session_logs SET session_id = NULL"); err != nil {
		return fmt.Errorf("detach session logs: %w", err)
	}
	for _, table := range []string{"tunnels", "session_tags", "sessions", "asset_tags", "asset_projects", "asset_environments", "ssh_keys", "session_folders", "macros"} {
		if _, err := tx.Exec("DELETE FROM " + table); err != nil {
			return fmt.Errorf("clear %s: %w", table, err)
		}
	}
	if _, err := tx.Exec("INSERT INTO session_folders (name, is_default) VALUES ('默认分组', 1)"); err != nil {
		return fmt.Errorf("recreate default folder: %w", err)
	}
	return tx.Commit()
}

func (s *SyncService) notifyDataChanged() {
	if s.eventBus != nil {
		s.eventBus.Emit(syncDataChangedEvent, map[string]bool{"changed": true})
	}
}
