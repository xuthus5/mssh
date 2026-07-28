package service

import (
	"crypto/hmac"
	"fmt"

	"github.com/xuthus5/mssh/internal/crypto"
)

// TryAutoUnlock restores the DEK from keychain when allowed by preferences.
//
//wails:ignore
func (s *SecurityService) TryAutoUnlock() error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	s.stateMu.Lock()
	unlocked, err := s.tryAutoUnlockLocked()
	s.stateMu.Unlock()
	if err != nil {
		return err
	}
	if unlocked {
		s.runAfterUnlock()
	}
	return nil
}

func (s *SecurityService) tryAutoUnlockLocked() (bool, error) {
	if !crypto.VaultExists(s.dataDir) {
		return false, nil
	}
	if s.boolSetting(securityRequireLaunchSetting, false) {
		return false, nil
	}
	if !s.boolSetting(securityRememberUnlockSetting, true) {
		return false, nil
	}
	if !s.keychainAvailable() {
		return false, nil
	}
	vault, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if err != nil {
		return false, fmt.Errorf("load vault for auto unlock: %w", err)
	}
	storedFingerprint, err := s.keychain.Get(securityKeychainService, securityKeychainVaultAccount)
	if err != nil {
		return false, fmt.Errorf("read remembered vault fingerprint: %w", err)
	}
	dek, err := s.keychain.Get(securityKeychainService, securityKeychainDEKAccount)
	if err != nil {
		return false, fmt.Errorf("read remembered vault DEK: %w", err)
	}
	defer clear(dek)
	if len(dek) != 32 {
		if clearErr := s.clearRememberedDEK(); clearErr != nil {
			s.warnKeychain("clear invalid remembered vault credentials failed", clearErr)
		}
		return false, nil
	}
	fingerprint, err := vaultFingerprint(vault, dek)
	if err != nil {
		return false, err
	}
	if !hmac.Equal(storedFingerprint, []byte(fingerprint)) {
		if clearErr := s.clearRememberedDEK(); clearErr != nil && s.logger != nil {
			s.logger.Warn("clear stale remembered vault credentials failed", "error", clearErr)
		}
		return false, nil
	}
	if err := s.setDEK(dek); err != nil {
		return false, err
	}
	return true, nil
}
