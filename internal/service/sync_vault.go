package service

import (
	"context"
	"errors"
	"fmt"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

// ImportWithPassword installs the embedded vault (if present) using the application password,
// then imports the encrypted snapshot. Intended for first-run restore on a new device.
func (s *SyncService) ImportWithPassword(path, password string) error {
	cleaned, err := validateLocalFilePath(path)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	path = cleaned
	if err := s.beginSyncOperation(); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	defer s.operationMu.Unlock()
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "import", TargetType: "backup", Summary: "导入加密配置", Outcome: outcome})
	}()
	content, err := readLocalBackup(path)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	if err := s.importPasswordContent(path, password, content); err != nil {
		return err
	}
	outcome = "success"
	return nil
}

func (s *SyncService) importPasswordContent(path, password string, content []byte) error {
	artifact, vault, err := decodePasswordProtectedArtifact(content, password)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	if err := validateSnapshot(s.db, artifact.Data); err != nil {
		return fmt.Errorf("import: validate: %w", err)
	}
	previousKey := ""
	if key, keyErr := s.masterKey(); keyErr == nil {
		previousKey = key
	}
	previousData, err := s.prepareImportRestore(previousKey)
	if err != nil {
		return fmt.Errorf("import: prepare: %w", err)
	}
	transaction, err := s.prepareVaultInstall(password, vault)
	if err != nil {
		return fmt.Errorf("import: install vault: %w", err)
	}
	if err := transaction.WithCryptoOperation(func() error { return s.restore(artifact.Data) }); err != nil {
		return rollbackVaultInstall(transaction, fmt.Errorf("import: restore: %w", err))
	}
	if err := transaction.Commit(); err != nil {
		state := passwordRestoreState{data: previousData}
		return s.rollbackVaultRestore(transaction, state, fmt.Errorf("import: commit vault: %w", err))
	}
	if err := s.applyRestoredProxySettings(); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	s.finishImportedSnapshot(path)
	return nil
}

// AdoptVaultFromContent installs the vault envelope embedded in a sync/backup artifact.
//
//wails:ignore
func (s *SyncService) AdoptVaultFromContent(password string, content []byte) error {
	if err := s.beginSyncOperation(); err != nil {
		return err
	}
	defer s.operationMu.Unlock()
	return s.adoptVaultFromContentLocked(password, content)
}

func (s *SyncService) adoptVaultFromContentLocked(password string, content []byte) error {
	artifact, vault, err := decodePasswordProtectedArtifact(content, password)
	if err != nil {
		return err
	}
	if err := validateSnapshot(s.db, artifact.Data); err != nil {
		return err
	}
	transaction, err := s.prepareVaultInstall(password, vault)
	if err != nil {
		return err
	}
	if err := transaction.Commit(); err != nil {
		return rollbackVaultInstall(transaction, err)
	}
	return nil
}

func (s *SyncService) masterKey() (string, error) {
	if s.secretSource != nil {
		key, err := s.secretSource()
		if err != nil {
			return "", fmt.Errorf("application vault is locked or not configured: %w", err)
		}
		if key == "" {
			return "", errors.New("application vault is locked or not configured")
		}
		return key, nil
	}
	return "", errors.New("application vault is locked or not configured")
}

func (s *SyncService) artifactVault() (*backupcrypto.VaultFile, error) {
	if s.vaultSource == nil {
		return nil, nil
	}
	vault, err := s.vaultSource()
	if err != nil {
		return nil, err
	}
	if vault == nil {
		return nil, nil
	}
	copyVault := *vault
	return &copyVault, nil
}

// JoinWithPassword bootstraps a new device from the remote cloud backup using the application password.
// It installs the embedded vault envelope, saves provider config/secrets, then restores remote data.
func (s *SyncService) JoinWithPassword(input model.SyncConfigInput, password string) (model.SyncResult, error) {
	operationContext, finish, err := s.beginCancelableSyncOperation(context.Background())
	if err != nil {
		return model.SyncResult{}, err
	}
	defer finish()
	config, remote, err := s.fetchJoinRemote(operationContext, input)
	if err != nil {
		return model.SyncResult{}, err
	}
	artifact, vault, err := decodePasswordProtectedArtifact(remote.Content, password)
	if err != nil {
		return model.SyncResult{}, err
	}
	if err := validateSnapshot(s.db, artifact.Data); err != nil {
		return model.SyncResult{}, fmt.Errorf("join: validate: %w", err)
	}
	request := passwordJoinRequest{input: input, password: password, config: config, artifact: artifact, vault: vault}
	s.configMu.Lock()
	err = s.restoreJoinedBackup(request)
	s.configMu.Unlock()
	if err != nil {
		return model.SyncResult{}, err
	}
	if err := s.applyRestoredProxySettings(); err != nil {
		return model.SyncResult{}, fmt.Errorf("join: %w", err)
	}
	s.restartScheduler()
	return s.finishJoinSuccess(config), nil
}

type passwordJoinRequest struct {
	input    model.SyncConfigInput
	password string
	config   model.SyncConfig
	artifact decodedSyncArtifact
	vault    backupcrypto.VaultFile
}

func (s *SyncService) restoreJoinedBackup(request passwordJoinRequest) error {
	previous, err := s.loadConfig()
	if err != nil {
		return err
	}
	previousKey := ""
	if key, keyErr := s.masterKey(); keyErr == nil {
		previousKey = key
	}
	previousData, err := s.prepareImportRestore(previousKey)
	if err != nil {
		return fmt.Errorf("join: prepare: %w", err)
	}
	previousSettings, err := store.ListSettings(s.db, "sync")
	if err != nil {
		return fmt.Errorf("join: capture sync settings: %w", err)
	}
	transaction, err := s.prepareVaultInstall(request.password, request.vault)
	if err != nil {
		return err
	}
	restoreErr := transaction.WithCryptoOperation(func() error {
		return s.restoreAndPersistJoin(request.artifact.Data, request.input, previous, request.config)
	})
	if restoreErr != nil {
		return rollbackVaultInstall(transaction, fmt.Errorf("join: restore: %w", restoreErr))
	}
	if err := transaction.Commit(); err != nil {
		state := passwordRestoreState{data: previousData, syncSettings: previousSettings, restoreSyncSettings: true}
		return s.rollbackVaultRestore(transaction, state, fmt.Errorf("join: commit vault: %w", err))
	}
	return nil
}

func (s *SyncService) fetchJoinRemote(parent context.Context, input model.SyncConfigInput) (model.SyncConfig, syncRemoteObject, error) {
	config := configFromInput(input)
	if err := validateSyncConfig(config); err != nil {
		return model.SyncConfig{}, syncRemoteObject{}, err
	}
	secrets, err := s.providerSecrets(config, &input)
	if err != nil {
		return model.SyncConfig{}, syncRemoteObject{}, err
	}
	if err := validateProviderReady(config, secrets); err != nil {
		return model.SyncConfig{}, syncRemoteObject{}, err
	}
	ctx, cancel := context.WithTimeout(parent, syncNetworkTimeout)
	defer cancel()
	provider, err := s.providerFactory.Create(ctx, config, secrets)
	if err != nil {
		return model.SyncConfig{}, syncRemoteObject{}, err
	}
	remote, err := provider.Fetch(ctx)
	if err != nil {
		return model.SyncConfig{}, syncRemoteObject{}, err
	}
	return config, remote, nil
}

func (s *SyncService) finishJoinSuccess(config model.SyncConfig) model.SyncResult {
	s.markPending("已从云端加入，等待同步")
	s.notifyDataChanged()
	result := model.SyncResult{State: model.SyncStateSynced, Message: "已从云端恢复"}
	s.setRuntimeState(syncRuntimeState{State: model.SyncStateSynced, Message: result.Message})
	s.recordSyncEvent("join", config, model.SyncEventSuccess, 0, 0, result.Message)
	return result
}
