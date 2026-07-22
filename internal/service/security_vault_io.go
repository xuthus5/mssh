package service

import (
	"encoding/json"
	"errors"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SecurityService) SyncSecret() (string, error) {
	dek, err := s.runtime.DEK()
	if err != nil {
		return "", err
	}
	return crypto.SyncSecretFromDEK(dek), nil
}

// ExportVaultFile returns the on-disk vault envelope for embedding in sync backups.
//
//wails:ignore
func (s *SecurityService) ExportVaultFile() (crypto.VaultFile, error) {
	if !crypto.VaultExists(s.dataDir) {
		return crypto.VaultFile{}, errors.New("application password is not configured")
	}
	return crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
}

// InstallVaultFromExport installs a remote vault envelope and unlocks it with password.
// Used when a device joins sync with the same application password.
//
//wails:ignore
func (s *SecurityService) InstallVaultFromExport(password string, vault crypto.VaultFile) error {
	dek, err := crypto.UnlockVault(password, vault)
	if err != nil {
		return err
	}
	if crypto.VaultExists(s.dataDir) {
		existing, loadErr := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
		if loadErr != nil {
			return loadErr
		}
		if existing.WrappedDEK != vault.WrappedDEK || existing.Salt != vault.Salt {
			return errors.New("application password is already configured on this device")
		}
	}
	if err := crypto.SaveVaultFile(crypto.VaultPath(s.dataDir), vault); err != nil {
		return err
	}
	s.runtime.SetDEK(dek)
	if s.boolSetting(securityRememberUnlockSetting, true) && !s.boolSetting(securityRequireLaunchSetting, false) {
		_ = s.persistRememberedDEK(dek)
	}
	if status, err := s.Status(); err == nil {
		s.emitVaultStatus(status)
	}
	return nil
}

func (s *SecurityService) savePreferences(requireLaunch, remember bool) error {
	if err := s.setBoolSetting(securityRequireLaunchSetting, requireLaunch); err != nil {
		return err
	}
	return s.setBoolSetting(securityRememberUnlockSetting, remember)
}

func (s *SecurityService) boolSetting(key string, fallback bool) bool {
	setting, err := store.GetSettingEntry(s.db, key)
	if err != nil || setting == nil {
		return fallback
	}
	var value bool
	if err := json.Unmarshal([]byte(setting.Value), &value); err != nil {
		return fallback
	}
	return value
}

func (s *SecurityService) setBoolSetting(key string, value bool) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return store.SetSettings(s.db, []model.Setting{{
		Key: key, Namespace: "security", Value: string(payload), ValueType: "boolean", Version: 1,
	}})
}

func (s *SecurityService) persistRememberedDEK(dek []byte) error {
	if s.keychain == nil || !s.keychain.IsAvailable() {
		return nil
	}
	return s.keychain.Set(securityKeychainService, securityKeychainDEKAccount, dek)
}

func (s *SecurityService) clearRememberedDEK() error {
	if s.keychain == nil || !s.keychain.IsAvailable() {
		return nil
	}
	return s.keychain.Delete(securityKeychainService, securityKeychainDEKAccount)
}
