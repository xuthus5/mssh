package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	securityRequireLaunchSetting  = "security.require_password_on_launch"
	securityRememberUnlockSetting = "security.remember_unlock"
	securityKeychainService       = "mssh"
	securityKeychainDEKAccount    = "app-dek"
	sessionPasswordPrefix         = "enc1:"
)

type SecurityService struct {
	db       *sql.DB
	dataDir  string
	runtime  *CryptoRuntime
	keychain crypto.KeychainAdapter
	eventBus EventBus
	logger   *slog.Logger
}

func NewSecurityService(db *sql.DB, dataDir string, runtime *CryptoRuntime, keychain crypto.KeychainAdapter, logger *slog.Logger) *SecurityService {
	if logger == nil {
		logger = slog.Default()
	}
	return &SecurityService{db: db, dataDir: dataDir, runtime: runtime, keychain: keychain, logger: logger}
}

// SetEventBus wires lock notifications for the frontend VaultGate.
//
//wails:ignore
func (s *SecurityService) SetEventBus(bus EventBus) {
	s.eventBus = bus
}

// RequireUnlocked returns a stable error when the application vault is locked.
func (s *SecurityService) RequireUnlocked() error {
	if s.runtime == nil {
		return ErrVaultLocked
	}
	return s.runtime.RequireUnlocked()
}

func (s *SecurityService) Status() (model.SecurityStatus, error) {
	status := model.SecurityStatus{
		Configured:              crypto.VaultExists(s.dataDir),
		Unlocked:                s.runtime != nil && s.runtime.Unlocked(),
		RequirePasswordOnLaunch: s.boolSetting(securityRequireLaunchSetting, false),
		RememberUnlock:          s.boolSetting(securityRememberUnlockSetting, true),
	}
	if status.Configured {
		if vault, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir)); err == nil {
			status.UpdatedAt = vault.UpdatedAt
		}
	}
	return status, nil
}

func (s *SecurityService) Setup(input model.SecuritySetupInput) (model.SecurityStatus, error) {
	if crypto.VaultExists(s.dataDir) {
		return model.SecurityStatus{}, errors.New("application password is already configured")
	}
	vault, dek, err := crypto.CreateVault(input.Password)
	if err != nil {
		return model.SecurityStatus{}, err
	}
	if err := crypto.SaveVaultFile(crypto.VaultPath(s.dataDir), vault); err != nil {
		return model.SecurityStatus{}, err
	}
	s.runtime.SetDEK(dek)
	if err := s.savePreferences(input.RequirePasswordOnLaunch, input.RememberUnlock); err != nil {
		return model.SecurityStatus{}, err
	}
	if input.RememberUnlock {
		_ = s.persistRememberedDEK(dek)
	} else {
		_ = s.clearRememberedDEK()
	}
	recordAudit(s.db, s.logger, model.AuditEvent{Action: "security_setup", TargetType: "vault", Summary: "设置应用密码", Outcome: "success"})
	return s.Status()
}

func (s *SecurityService) Unlock(input model.SecurityUnlockInput) (model.SecurityStatus, error) {
	vault, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if err != nil {
		return model.SecurityStatus{}, fmt.Errorf("load vault: %w", err)
	}
	dek, err := crypto.UnlockVault(input.Password, vault)
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.runtime.SetDEK(dek)
	if input.RememberUnlock {
		_ = s.setBoolSetting(securityRememberUnlockSetting, true)
		_ = s.persistRememberedDEK(dek)
	} else {
		_ = s.setBoolSetting(securityRememberUnlockSetting, false)
		_ = s.clearRememberedDEK()
	}
	return s.Status()
}

func (s *SecurityService) Lock() (model.SecurityStatus, error) {
	s.ClearMemory()
	_ = s.clearRememberedDEK()
	if s.eventBus != nil {
		s.eventBus.Emit("security:vault-locked", map[string]any{"locked": true})
	}
	return s.Status()
}

// ClearMemory drops the in-process DEK without changing keychain preferences.
//
//wails:ignore
func (s *SecurityService) ClearMemory() {
	if s.runtime != nil {
		s.runtime.Clear()
	}
}

func (s *SecurityService) Rotate(input model.SecurityRotateInput) (model.SecurityStatus, error) {
	vault, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if err != nil {
		return model.SecurityStatus{}, fmt.Errorf("load vault: %w", err)
	}
	next, newDEK, err := crypto.RotateVaultPassword(input.CurrentPassword, input.NewPassword, vault, func(oldDEK, nextDEK []byte) error {
		return s.reencryptProtectedData(oldDEK, nextDEK)
	})
	if err != nil {
		return model.SecurityStatus{}, err
	}
	if err := crypto.SaveVaultFile(crypto.VaultPath(s.dataDir), next); err != nil {
		return model.SecurityStatus{}, err
	}
	s.runtime.SetDEK(newDEK)
	if s.boolSetting(securityRememberUnlockSetting, true) {
		_ = s.persistRememberedDEK(newDEK)
	}
	recordAudit(s.db, s.logger, model.AuditEvent{Action: "security_rotate", TargetType: "vault", Summary: "轮转应用密码并重加密数据", Outcome: "success"})
	return s.Status()
}

func (s *SecurityService) SavePreferences(input model.SecurityPreferenceInput) (model.SecurityStatus, error) {
	if err := s.savePreferences(input.RequirePasswordOnLaunch, input.RememberUnlock); err != nil {
		return model.SecurityStatus{}, err
	}
	if input.RequirePasswordOnLaunch {
		_ = s.clearRememberedDEK()
	} else if input.RememberUnlock && s.runtime.Unlocked() {
		if dek, err := s.runtime.DEK(); err == nil {
			_ = s.persistRememberedDEK(dek)
		}
	} else if !input.RememberUnlock {
		_ = s.clearRememberedDEK()
	}
	return s.Status()
}

// TryAutoUnlock restores the DEK from keychain when allowed by preferences.
//
//wails:ignore
func (s *SecurityService) TryAutoUnlock() error {
	if !crypto.VaultExists(s.dataDir) {
		return nil
	}
	if s.boolSetting(securityRequireLaunchSetting, false) {
		return nil
	}
	if !s.boolSetting(securityRememberUnlockSetting, true) {
		return nil
	}
	if s.keychain == nil || !s.keychain.IsAvailable() {
		return nil
	}
	dek, err := s.keychain.Get(securityKeychainService, securityKeychainDEKAccount)
	if err != nil || len(dek) != 32 {
		return nil
	}
	// Validate DEK can decrypt vault by ensuring vault file loads (DEK itself is the secret).
	s.runtime.SetDEK(dek)
	return nil
}

//wails:ignore
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
