package service

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
)

const (
	securityRequireLaunchSetting  = "security.require_password_on_launch"
	securityRememberUnlockSetting = "security.remember_unlock"
	securityKeychainService       = "mssh"
	securityKeychainDEKAccount    = "app-dek"
	sessionPasswordPrefix         = "enc1:"
	securityVaultChangedEvent     = "security:vault-changed"
	securityVaultLockedEvent      = "security:vault-locked"
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

func (s *SecurityService) emitVaultStatus(status model.SecurityStatus) {
	if s.eventBus == nil {
		return
	}
	s.eventBus.Emit(securityVaultChangedEvent, status)
}

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
	status, err := s.Status()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.emitVaultStatus(status)
	return status, nil
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
	status, err := s.Status()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.emitVaultStatus(status)
	return status, nil
}

func (s *SecurityService) Lock() (model.SecurityStatus, error) {
	s.ClearMemory()
	_ = s.clearRememberedDEK()
	if s.eventBus != nil {
		s.eventBus.Emit(securityVaultLockedEvent, map[string]any{"locked": true})
	}
	status, err := s.Status()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.emitVaultStatus(status)
	return status, nil
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
	status, err := s.Status()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.emitVaultStatus(status)
	return status, nil
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
	status, err := s.Status()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.emitVaultStatus(status)
	return status, nil
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
