package service

import (
	"context"
	"errors"
	"fmt"
	"os"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
)

// ImportWithPassword installs the embedded vault (if present) using the application password,
// then imports the encrypted snapshot. Intended for first-run restore on a new device.
func (s *SyncService) ImportWithPassword(path, password string) error {
	cleaned, err := validateLocalFilePath(path)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	path = cleaned
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	if err := s.AdoptVaultFromContent(password, content); err != nil {
		// Legacy backups without vault still import when local secret already matches.
		if !errors.Is(err, errSyncVaultMissing) {
			return fmt.Errorf("import: %w", err)
		}
	}
	return s.Import(path)
}

// AdoptVaultFromContent installs the vault envelope embedded in a sync/backup artifact.
func (s *SyncService) AdoptVaultFromContent(password string, content []byte) error {
	if s.vaultInstaller == nil {
		return errors.New("vault installer is not configured")
	}
	vault, err := peekSyncArtifactVault(content)
	if err != nil {
		return errSyncVaultMissing
	}
	if vault == nil {
		return errSyncVaultMissing
	}
	if err := s.vaultInstaller(password, *vault); err != nil {
		return err
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
	// Legacy fallback removed: unified app password is mandatory for encrypted sync.
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
	if !s.operationMu.TryLock() {
		return model.SyncResult{}, errors.New("sync operation is already running")
	}
	defer s.operationMu.Unlock()
	config, remote, err := s.fetchJoinRemote(input)
	if err != nil {
		return model.SyncResult{}, err
	}
	if err := s.installJoinVaultAndConfig(input, password, remote.Content); err != nil {
		return model.SyncResult{}, err
	}
	if err := s.restoreJoinSnapshot(remote.Content); err != nil {
		return model.SyncResult{}, err
	}
	return s.finishJoinSuccess(config), nil
}

func (s *SyncService) fetchJoinRemote(input model.SyncConfigInput) (model.SyncConfig, syncRemoteObject, error) {
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
	ctx, cancel := context.WithTimeout(context.Background(), syncNetworkTimeout)
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

func (s *SyncService) installJoinVaultAndConfig(input model.SyncConfigInput, password string, content []byte) error {
	if err := s.AdoptVaultFromContent(password, content); err != nil {
		return fmt.Errorf("join: %w", err)
	}
	if _, err := s.SaveConfig(input); err != nil {
		return fmt.Errorf("join: save config: %w", err)
	}
	return nil
}

func (s *SyncService) restoreJoinSnapshot(content []byte) error {
	masterKey, err := s.masterKey()
	if err != nil {
		return err
	}
	artifact, err := decodeSyncArtifact(content, masterKey)
	if err != nil {
		return fmt.Errorf("join: decrypt: %w", err)
	}
	if err := validateSnapshot(s.db, artifact.Data); err != nil {
		return fmt.Errorf("join: validate: %w", err)
	}
	if s.lifecycle != nil {
		if err := s.lifecycle.PrepareDestructiveSync(); err != nil {
			return fmt.Errorf("join: prepare: %w", err)
		}
	}
	if err := s.restore(artifact.Data); err != nil {
		return fmt.Errorf("join: restore: %w", err)
	}
	return nil
}

func (s *SyncService) finishJoinSuccess(config model.SyncConfig) model.SyncResult {
	s.markPending("已从云端加入，等待同步")
	s.notifyDataChanged()
	result := model.SyncResult{State: model.SyncStateSynced, Message: "已从云端恢复"}
	s.setRuntimeState(syncRuntimeState{State: model.SyncStateSynced, Message: result.Message})
	s.recordSyncEvent("join", config, model.SyncEventSuccess, 0, 0, result.Message)
	return result
}
