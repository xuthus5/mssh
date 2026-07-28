package service

import (
	"errors"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type passwordRestoreState struct {
	data                ExportData
	syncSettings        []model.Setting
	restoreSyncSettings bool
}

func (s *SyncService) rollbackVaultRestore(transaction VaultInstallTransaction, state passwordRestoreState, cause error) error {
	rollbackErrors := []error{cause}
	if err := s.restorePasswordState(state); err != nil {
		rollbackErrors = append(rollbackErrors, fmt.Errorf("restore pre-import data: %w", err))
	}
	if err := transaction.Rollback(); err != nil {
		rollbackErrors = append(rollbackErrors, fmt.Errorf("rollback vault install: %w", err))
	}
	return errors.Join(rollbackErrors...)
}

func (s *SyncService) restorePasswordState(state passwordRestoreState) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin password restore rollback: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := restoreIntoTransaction(tx, state.data); err != nil {
		return err
	}
	if state.restoreSyncSettings {
		if _, err := tx.Exec("DELETE FROM settings WHERE namespace = ?", "sync"); err != nil {
			return fmt.Errorf("clear joined sync settings: %w", err)
		}
		if err := store.SetSettingsTx(tx, state.syncSettings); err != nil {
			return fmt.Errorf("restore joined sync settings: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit password restore rollback: %w", err)
	}
	return nil
}
