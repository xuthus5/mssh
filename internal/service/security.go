package service

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
)

const (
	securityRequireLaunchSetting     = "security.require_password_on_launch"
	securityRememberUnlockSetting    = "security.remember_unlock"
	securityKeychainService          = "mssh"
	securityKeychainDEKAccount       = "app-dek"
	securityKeychainVaultAccount     = "app-vault-fingerprint"
	sessionPasswordPrefix            = "enc1:"
	securityVaultChangedEvent        = "security:vault-changed"
	securityVaultLockedEvent         = "security:vault-locked"
	securityVaultRememberFailedEvent = "security:remember-failed"
)

type SecurityService struct {
	db            *sql.DB
	dataDir       string
	runtime       *CryptoRuntime
	keychain      crypto.KeychainAdapter
	eventBus      EventBus
	logger        *slog.Logger
	unlock        *unlockLimiter
	afterUnlock   func()
	stateMu       sync.Mutex
	callbackMu    sync.RWMutex
	saveVaultFile func(string, crypto.VaultFile) error
	lifecycle     securityServiceLifecycle
}

func NewSecurityService(db *sql.DB, dataDir string, runtime *CryptoRuntime, keychain crypto.KeychainAdapter, logger *slog.Logger) *SecurityService {
	if logger == nil {
		logger = slog.Default()
	}
	return &SecurityService{db: db, dataDir: dataDir, runtime: runtime, keychain: keychain, logger: logger, unlock: newUnlockLimiter(), saveVaultFile: crypto.SaveVaultFile}
}

// VerifyPassword confirms the application password without changing unlock state.
// Failed attempts consume the unlock rate limiter.
//
//wails:ignore
func (s *SecurityService) VerifyPassword(password string) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if err := s.unlock.allow(); err != nil {
		return err
	}
	if strings.TrimSpace(password) == "" {
		s.unlock.failure()
		return errors.New("application password is required")
	}
	if !crypto.VaultExists(s.dataDir) {
		return errors.New("application password is not configured")
	}
	vault, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if err != nil {
		return fmt.Errorf("load vault: %w", err)
	}
	dek, err := crypto.UnlockVault(password, vault)
	if err != nil {
		s.unlock.failure()
		return err
	}
	clear(dek)
	s.unlock.success()
	return nil
}

func (s *SecurityService) Status() (model.SecurityStatus, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer finish()
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.statusLocked()
}

func (s *SecurityService) statusLocked() (model.SecurityStatus, error) {
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
	finish, err := s.beginOperation()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer finish()
	s.stateMu.Lock()
	status, err := s.setupLocked(input)
	s.stateMu.Unlock()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.runAfterUnlock()
	recordAudit(s.db, s.logger, model.AuditEvent{Action: "security_setup", TargetType: "vault", Summary: "设置应用密码", Outcome: "success"})
	s.emitVaultStatus(status)
	return status, nil
}

func (s *SecurityService) setupLocked(input model.SecuritySetupInput) (model.SecurityStatus, error) {
	if crypto.VaultExists(s.dataDir) {
		return model.SecurityStatus{}, errors.New("application password is already configured")
	}
	runtime, err := s.requireRuntime()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	state, err := s.captureSecurityMutationState(runtime)
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer clearVaultInstallState(&state)
	vault, dek, err := crypto.CreateVault(input.Password)
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer clear(dek)
	if err := crypto.SaveVaultFile(crypto.VaultPath(s.dataDir), vault); err != nil {
		return model.SecurityStatus{}, s.rollbackSecurityMutation(runtime, &state, err)
	}
	if err := s.setDEK(dek); err != nil {
		return model.SecurityStatus{}, s.rollbackSecurityMutation(runtime, &state, err)
	}
	if err := s.configureUnlockPreferences(input.RequirePasswordOnLaunch, input.RememberUnlock, dek); err != nil {
		return model.SecurityStatus{}, s.rollbackSecurityMutation(runtime, &state, err)
	}
	status, err := s.statusLocked()
	if err != nil {
		return model.SecurityStatus{}, s.rollbackSecurityMutation(runtime, &state, err)
	}
	return status, nil
}

func (s *SecurityService) Unlock(input model.SecurityUnlockInput) (model.SecurityStatus, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer finish()
	s.stateMu.Lock()
	status, err := s.unlockLocked(input)
	s.stateMu.Unlock()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.runAfterUnlock()
	s.emitVaultStatus(status)
	return status, nil
}

func (s *SecurityService) unlockLocked(input model.SecurityUnlockInput) (model.SecurityStatus, error) {
	if err := s.unlock.allow(); err != nil {
		return model.SecurityStatus{}, err
	}
	vault, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if err != nil {
		return model.SecurityStatus{}, fmt.Errorf("load vault: %w", err)
	}
	dek, err := crypto.UnlockVault(input.Password, vault)
	if err != nil {
		s.unlock.failure()
		return model.SecurityStatus{}, err
	}
	defer clear(dek)
	s.unlock.success()
	runtime, err := s.requireRuntime()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	state, err := s.captureSecurityMutationState(runtime)
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer clearVaultInstallState(&state)
	if err := s.setDEK(dek); err != nil {
		return model.SecurityStatus{}, s.rollbackSecurityMutation(runtime, &state, err)
	}
	requireLaunch := s.boolSetting(securityRequireLaunchSetting, false)
	if err := s.configureUnlockPreferences(requireLaunch, input.RememberUnlock, dek); err != nil {
		return model.SecurityStatus{}, s.rollbackSecurityMutation(runtime, &state, err)
	}
	status, err := s.statusLocked()
	if err != nil {
		return model.SecurityStatus{}, s.rollbackSecurityMutation(runtime, &state, err)
	}
	return status, nil
}

func (s *SecurityService) rollbackSecurityMutation(runtime *CryptoRuntime, state *vaultInstallState, cause error) error {
	restoreErr := s.restoreVaultInstallState(runtime, *state)
	if !state.keychainUnknown {
		return errors.Join(cause, restoreErr)
	}
	requireLaunch := s.boolSetting(securityRequireLaunchSetting, false)
	disableErr := s.savePreferences(requireLaunch, false)
	clearErr := s.clearRememberedDEK()
	return errors.Join(cause, restoreErr, disableErr, clearErr)
}

func (s *SecurityService) Lock() (model.SecurityStatus, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer finish()
	s.stateMu.Lock()
	status, err := s.lockLocked()
	s.stateMu.Unlock()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.emitVaultLocked()
	return status, nil
}

func (s *SecurityService) lockLocked() (model.SecurityStatus, error) {
	if err := s.clearDEK(); err != nil {
		return model.SecurityStatus{}, err
	}
	requireLaunch := s.boolSetting(securityRequireLaunchSetting, false)
	if err := s.configureUnlockPreferences(requireLaunch, false, nil); err != nil {
		return model.SecurityStatus{}, err
	}
	return s.statusLocked()
}

func (s *SecurityService) Rotate(input model.SecurityRotateInput) (model.SecurityStatus, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer finish()
	s.stateMu.Lock()
	status, err := s.rotateLocked(input)
	s.stateMu.Unlock()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.runAfterUnlock()
	recordAudit(s.db, s.logger, model.AuditEvent{Action: "security_rotate", TargetType: "vault", Summary: "轮转应用密码并重加密数据", Outcome: "success"})
	s.emitVaultStatus(status)
	return status, nil
}

func (s *SecurityService) rotateLocked(input model.SecurityRotateInput) (model.SecurityStatus, error) {
	if _, err := s.requireRuntime(); err != nil {
		return model.SecurityStatus{}, ErrVaultLocked
	}
	if err := s.runtime.WithCryptoOperation(func() error { return s.rotateProtectedData(input) }); err != nil {
		return model.SecurityStatus{}, err
	}
	dek, err := s.runtime.DEK()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer clear(dek)
	if s.boolSetting(securityRememberUnlockSetting, true) {
		requireLaunch := s.boolSetting(securityRequireLaunchSetting, false)
		if err := s.configureUnlockPreferences(requireLaunch, true, dek); err != nil {
			return model.SecurityStatus{}, err
		}
	}
	return s.statusLocked()
}
