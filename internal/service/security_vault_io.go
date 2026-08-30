package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

// rememberedDEKHexPrefix marks DEK values stored in the keychain as hex text.
// Raw binary secrets are rejected by strict Secret Service providers (for
// example KDE ksecretd) that enforce UTF-8 on text/plain content.
const rememberedDEKHexPrefix = "dek1:"

//wails:ignore
func (s *SecurityService) SyncSecret() (string, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return "", err
	}
	defer finish()
	runtime, err := s.requireRuntime()
	if err != nil {
		return "", err
	}
	dek, err := runtime.DEK()
	if err != nil {
		return "", err
	}
	defer clear(dek)
	return crypto.SyncSecretFromDEK(dek), nil
}

// ExportVaultFile returns the on-disk vault envelope for embedding in sync backups.
//
//wails:ignore
func (s *SecurityService) ExportVaultFile() (crypto.VaultFile, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return crypto.VaultFile{}, err
	}
	defer finish()
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
	transaction, err := s.PrepareVaultFromExport(password, vault)
	if err != nil {
		return err
	}
	if err := transaction.Commit(); err != nil {
		rollbackErr := transaction.Rollback()
		return errors.Join(err, rollbackErr)
	}
	return nil
}

func (s *SecurityService) installVaultFromExportLocked(runtime *CryptoRuntime, password string, vault crypto.VaultFile) (model.SecurityStatus, error) {
	dek, err := crypto.UnlockVault(password, vault)
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer clear(dek)
	if crypto.VaultExists(s.dataDir) {
		existing, loadErr := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
		if loadErr != nil {
			return model.SecurityStatus{}, loadErr
		}
		if existing.WrappedDEK != vault.WrappedDEK || existing.Salt != vault.Salt {
			return model.SecurityStatus{}, errors.New("application password is already configured on this device")
		}
	}
	if err := crypto.SaveVaultFile(crypto.VaultPath(s.dataDir), vault); err != nil {
		return model.SecurityStatus{}, err
	}
	runtime.SetDEK(dek)
	requireLaunch := s.boolSetting(securityRequireLaunchSetting, false)
	remember := s.boolSetting(securityRememberUnlockSetting, true)
	if err := s.configureUnlockPreferences(requireLaunch, remember, dek); err != nil {
		return model.SecurityStatus{}, err
	}
	return s.statusLocked()
}

func (s *SecurityService) savePreferences(requireLaunch, remember bool) error {
	requirePayload, err := json.Marshal(requireLaunch)
	if err != nil {
		return err
	}
	rememberPayload, err := json.Marshal(remember)
	if err != nil {
		return err
	}
	return store.SetSettings(s.db, []model.Setting{
		{Key: securityRequireLaunchSetting, Namespace: "security", Value: string(requirePayload), ValueType: "boolean", Version: 1},
		{Key: securityRememberUnlockSetting, Namespace: "security", Value: string(rememberPayload), ValueType: "boolean", Version: 1},
	})
}

func (s *SecurityService) configureUnlockPreferences(requireLaunch, remember bool, dek []byte) error {
	effectiveRemember := remember && !requireLaunch && s.keychainAvailable()
	if remember && !requireLaunch && !effectiveRemember {
		s.warnKeychain("remember unlock disabled because secure storage is unavailable", nil)
	}
	if err := s.savePreferences(requireLaunch, effectiveRemember); err != nil {
		return err
	}
	if !effectiveRemember {
		if err := s.clearRememberedDEK(); err != nil {
			s.warnKeychain("clear remembered unlock failed; auto unlock remains disabled by preference", err)
		}
		return nil
	}
	if err := s.persistRememberedDEK(dek); err == nil {
		return nil
	} else {
		s.warnKeychain("remember unlock failed; disabling preference", err)
		s.emitRememberFailed(err)
		rollbackErr := s.savePreferences(requireLaunch, false)
		if clearErr := s.clearRememberedDEK(); clearErr != nil {
			s.warnKeychain("clear partial remembered unlock failed", clearErr)
		}
		if rollbackErr != nil {
			return errors.Join(fmt.Errorf("remember unlock: %w", err), fmt.Errorf("disable remember unlock: %w", rollbackErr))
		}
		return nil
	}
}

func (s *SecurityService) keychainAvailable() bool {
	return s.keychain != nil && s.keychain.IsAvailable()
}

func (s *SecurityService) warnKeychain(message string, err error) {
	if s.logger == nil {
		return
	}
	if err == nil {
		s.logger.Warn(message)
		return
	}
	s.logger.Warn(message, "error", err)
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

func (s *SecurityService) persistRememberedDEK(dek []byte) error {
	if s.keychain == nil || !s.keychain.IsAvailable() {
		return nil
	}
	if len(dek) != 32 {
		return errors.New("remembered vault DEK has invalid length")
	}
	vault, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if err != nil {
		return fmt.Errorf("load vault for remembered unlock: %w", err)
	}
	fingerprint, err := vaultFingerprint(vault, dek)
	if err != nil {
		return err
	}
	if err := s.keychain.Set(securityKeychainService, securityKeychainVaultAccount, []byte(fingerprint)); err != nil {
		return fmt.Errorf("store remembered vault fingerprint: %w", err)
	}
	if err := s.keychain.Set(securityKeychainService, securityKeychainDEKAccount, encodeRememberedDEK(dek)); err != nil {
		cleanupErr := s.keychain.Delete(securityKeychainService, securityKeychainVaultAccount)
		return errors.Join(fmt.Errorf("store remembered vault DEK: %w", err), cleanupErr)
	}
	return nil
}

// encodeRememberedDEK renders the binary DEK as an ASCII hex string so strict
// Secret Service providers accept the value as text.
func encodeRememberedDEK(dek []byte) []byte {
	return []byte(rememberedDEKHexPrefix + hex.EncodeToString(dek))
}

// decodeRememberedDEK restores the DEK stored by encodeRememberedDEK. The bool
// result is false for legacy raw-binary values, malformed text, or a wrong
// length; callers must then clear the remembered credentials.
func decodeRememberedDEK(stored []byte) ([]byte, bool) {
	text := string(stored)
	if !strings.HasPrefix(text, rememberedDEKHexPrefix) {
		return nil, false
	}
	dek, err := hex.DecodeString(strings.TrimPrefix(text, rememberedDEKHexPrefix))
	if err != nil || len(dek) != 32 {
		clear(dek)
		return nil, false
	}
	return dek, true
}

func (s *SecurityService) clearRememberedDEK() error {
	if s.keychain == nil || !s.keychain.IsAvailable() {
		return nil
	}
	var clearErrors []error
	if err := s.keychain.Delete(securityKeychainService, securityKeychainDEKAccount); err != nil {
		clearErrors = append(clearErrors, err)
	}
	if err := s.keychain.Delete(securityKeychainService, securityKeychainVaultAccount); err != nil {
		clearErrors = append(clearErrors, err)
	}
	return errors.Join(clearErrors...)
}

func vaultFingerprint(vault crypto.VaultFile, dek []byte) (string, error) {
	if len(dek) != 32 {
		return "", errors.New("remembered vault DEK has invalid length")
	}
	payload, err := json.Marshal(vault)
	if err != nil {
		return "", fmt.Errorf("encode vault fingerprint: %w", err)
	}
	digest := hmac.New(sha256.New, dek)
	if _, err := digest.Write(payload); err != nil {
		return "", fmt.Errorf("hash vault fingerprint: %w", err)
	}
	return "v2:" + hex.EncodeToString(digest.Sum(nil)), nil
}
