package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *SecurityService) captureVaultInstallState(runtime *CryptoRuntime) (vaultInstallState, error) {
	state, err := s.captureVaultCoreState(runtime)
	if err != nil {
		return vaultInstallState{}, err
	}
	if err := s.captureVaultKeychain(&state); err != nil {
		clearVaultInstallState(&state)
		return vaultInstallState{}, fmt.Errorf("capture remembered unlock: %w", err)
	}
	return state, nil
}

func (s *SecurityService) captureSecurityMutationState(runtime *CryptoRuntime) (vaultInstallState, error) {
	state, err := s.captureVaultCoreState(runtime)
	if err != nil {
		return vaultInstallState{}, err
	}
	if !s.keychainAvailable() {
		return state, nil
	}
	if err := s.captureVaultKeychain(&state); err != nil {
		state.keychainUnknown = true
		s.warnKeychain("capture remembered unlock for rollback failed", err)
	}
	return state, nil
}

func (s *SecurityService) captureVaultCoreState(runtime *CryptoRuntime) (vaultInstallState, error) {
	state := vaultInstallState{settings: make(map[string]model.Setting), keychain: make(map[string][]byte)}
	settings, err := store.GetSettings(s.db, []string{securityRequireLaunchSetting, securityRememberUnlockSetting})
	if err != nil {
		return vaultInstallState{}, fmt.Errorf("capture vault preferences: %w", err)
	}
	for key, setting := range settings {
		state.settings[key] = setting
	}
	if dek, err := runtime.DEK(); err == nil {
		state.dek = dek
	}
	if !crypto.VaultExists(s.dataDir) {
		return state, nil
	}
	vault, err := crypto.LoadVaultFile(crypto.VaultPath(s.dataDir))
	if err != nil {
		return vaultInstallState{}, fmt.Errorf("capture current vault: %w", err)
	}
	state.vault = &vault
	return state, nil
}

func (s *SecurityService) captureVaultKeychain(state *vaultInstallState) error {
	if !s.keychainAvailable() {
		return nil
	}
	captured := make(map[string][]byte)
	for _, account := range []string{securityKeychainDEKAccount, securityKeychainVaultAccount} {
		value, err := s.keychain.Get(securityKeychainService, account)
		if err != nil {
			clearCapturedKeychain(captured)
			return err
		}
		if value != nil {
			captured[account] = append([]byte(nil), value...)
		}
	}
	state.keychain = captured
	state.keychainOK = true
	return nil
}

func clearCapturedKeychain(values map[string][]byte) {
	for account, value := range values {
		clear(value)
		delete(values, account)
	}
}
