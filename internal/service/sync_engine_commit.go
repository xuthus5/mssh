package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SyncService) commitSuccessfulSync(provider model.SyncProvider, previous, baseline syncBaseline) error {
	setting, err := buildSyncSetting(syncBaselineSetting(provider), baseline)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin sync state commit: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if previous.LocalVersionID > 0 && previous.LocalVersionID != baseline.LocalVersionID {
		if err := store.SetSyncVersionProtectedTx(tx, previous.LocalVersionID, false); err != nil {
			return err
		}
	}
	if err := store.SetSyncVersionProtectedTx(tx, baseline.LocalVersionID, true); err != nil {
		return err
	}
	if err := store.SetSettingsTx(tx, []model.Setting{setting}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit sync state: %w", err)
	}
	return nil
}
