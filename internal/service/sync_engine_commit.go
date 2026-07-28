package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type successfulSyncCommit struct {
	Provider model.SyncProvider
	Previous syncBaseline
	Baseline syncBaseline
	Restore  *ExportData
}

func (s *SyncService) commitSuccessfulSync(commit successfulSyncCommit) error {
	setting, err := buildSyncSetting(syncBaselineSetting(commit.Provider), commit.Baseline)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin sync state commit: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if commit.Restore != nil {
		if err := restoreIntoTransaction(tx, *commit.Restore); err != nil {
			return err
		}
	}
	if commit.Previous.LocalVersionID > 0 && commit.Previous.LocalVersionID != commit.Baseline.LocalVersionID {
		if err := store.SetSyncVersionProtectedTx(tx, commit.Previous.LocalVersionID, false); err != nil {
			return err
		}
	}
	if err := store.SetSyncVersionProtectedTx(tx, commit.Baseline.LocalVersionID, true); err != nil {
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
