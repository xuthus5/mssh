package service

import (
	"errors"
	"fmt"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
)

func decodePasswordProtectedArtifact(content []byte, password string) (decodedSyncArtifact, backupcrypto.VaultFile, error) {
	vault, err := peekSyncArtifactVault(content)
	if err != nil {
		return decodedSyncArtifact{}, backupcrypto.VaultFile{}, err
	}
	dek, err := backupcrypto.UnlockVault(password, *vault)
	if err != nil {
		return decodedSyncArtifact{}, backupcrypto.VaultFile{}, fmt.Errorf("unlock backup vault: %w", err)
	}
	defer clear(dek)
	secret := backupcrypto.SyncSecretFromDEK(dek)
	artifact, err := decodeSyncArtifact(content, secret)
	if err != nil {
		return decodedSyncArtifact{}, backupcrypto.VaultFile{}, fmt.Errorf("decrypt backup: %w", err)
	}
	return artifact, *vault, nil
}

func (s *SyncService) prepareVaultInstall(password string, vault backupcrypto.VaultFile) (VaultInstallTransaction, error) {
	if s.vaultTransactionInstaller == nil {
		return nil, errors.New("transactional vault installer is not configured")
	}
	transaction, err := s.vaultTransactionInstaller(password, vault)
	if err != nil {
		return nil, err
	}
	if transaction == nil {
		return nil, errors.New("transactional vault installer returned no transaction")
	}
	return transaction, nil
}

func rollbackVaultInstall(transaction VaultInstallTransaction, cause error) error {
	if err := transaction.Rollback(); err != nil {
		return errors.Join(cause, fmt.Errorf("rollback vault install: %w", err))
	}
	return cause
}

func (s *SyncService) restoreAndPersistJoin(data ExportData, input model.SyncConfigInput, previous, config model.SyncConfig) error {
	changes, err := s.prepareInputSecrets(input)
	if err != nil {
		return err
	}
	configSetting, err := buildSyncSetting(syncConfigSetting, config)
	if err != nil {
		return err
	}
	changes.settings = append(changes.settings, configSetting)
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin join restore: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := restoreIntoTransaction(tx, data); err != nil {
		return err
	}
	if err := applySyncConfigChangesTx(tx, changes, previous, config); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit join restore: %w", err)
	}
	return nil
}
