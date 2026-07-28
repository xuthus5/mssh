package service

import (
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

var errVaultInstallTransactionClosed = errors.New("vault install transaction is already closed")

// VaultInstallTransaction defers unlock notifications until the restored data is committed.
type VaultInstallTransaction interface {
	WithCryptoOperation(operation func() error) error
	Commit() error
	Rollback() error
}

type vaultInstallTransaction struct {
	mu         sync.Mutex
	operation  func(func() error) error
	commit     func() error
	rollback   func() error
	finish     func()
	finishOnce sync.Once
	committed  bool
	rolledBack bool
}

func (t *vaultInstallTransaction) WithCryptoOperation(operation func() error) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.committed || t.rolledBack {
		return errVaultInstallTransactionClosed
	}
	if t.operation == nil {
		return operation()
	}
	return t.operation(operation)
}

func (t *vaultInstallTransaction) Commit() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.rolledBack {
		return errVaultInstallTransactionClosed
	}
	if t.committed {
		return nil
	}
	if err := t.commit(); err != nil {
		return err
	}
	t.committed = true
	t.finishLifecycle()
	return nil
}

func (t *vaultInstallTransaction) Rollback() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.committed {
		return errVaultInstallTransactionClosed
	}
	if t.rolledBack {
		return nil
	}
	t.rolledBack = true
	err := t.rollback()
	t.finishLifecycle()
	return err
}

func (t *vaultInstallTransaction) finishLifecycle() {
	if t.finish != nil {
		t.finishOnce.Do(t.finish)
	}
}

type vaultInstallState struct {
	vault           *crypto.VaultFile
	dek             []byte
	settings        map[string]model.Setting
	keychain        map[string][]byte
	keychainOK      bool
	keychainUnknown bool
}

func (s *SecurityService) restoreVaultInstallState(runtime *CryptoRuntime, state vaultInstallState) error {
	var restoreErrors []error
	if err := s.restoreVaultRuntime(runtime, state); err != nil {
		restoreErrors = append(restoreErrors, fmt.Errorf("restore vault runtime: %w", err))
	}
	if err := s.restoreVaultPreferences(state.settings); err != nil {
		restoreErrors = append(restoreErrors, err)
	}
	if err := s.restoreVaultKeychain(state); err != nil {
		restoreErrors = append(restoreErrors, err)
	}
	return errors.Join(restoreErrors...)
}

func (s *SecurityService) restoreVaultRuntime(runtime *CryptoRuntime, state vaultInstallState) error {
	if state.vault == nil {
		if err := os.Remove(crypto.VaultPath(s.dataDir)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	} else if err := s.saveVault(*state.vault); err != nil {
		return err
	}
	if len(state.dek) == 0 {
		runtime.Clear()
		return nil
	}
	runtime.SetDEK(state.dek)
	return nil
}

func clearVaultInstallState(state *vaultInstallState) {
	clear(state.dek)
	state.dek = nil
	for account, value := range state.keychain {
		clear(value)
		delete(state.keychain, account)
	}
}

func (s *SecurityService) restoreVaultKeychain(state vaultInstallState) error {
	if !state.keychainOK {
		return nil
	}
	var restoreErrors []error
	for _, account := range []string{securityKeychainDEKAccount, securityKeychainVaultAccount} {
		var err error
		if value, ok := state.keychain[account]; ok {
			err = s.keychain.Set(securityKeychainService, account, value)
		} else {
			err = s.keychain.Delete(securityKeychainService, account)
		}
		if err != nil {
			restoreErrors = append(restoreErrors, fmt.Errorf("restore remembered unlock: %w", err))
		}
	}
	return errors.Join(restoreErrors...)
}

func (s *SecurityService) restoreVaultPreferences(previous map[string]model.Setting) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin vault preference rollback: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, key := range []string{securityRequireLaunchSetting, securityRememberUnlockSetting} {
		setting, ok := previous[key]
		if ok {
			if err := store.SetSettingsTx(tx, []model.Setting{setting}); err != nil {
				return fmt.Errorf("restore vault preference %s: %w", key, err)
			}
			continue
		}
		if _, err := tx.Exec("DELETE FROM settings WHERE key = ?", key); err != nil {
			return fmt.Errorf("delete vault preference %s: %w", key, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit vault preference rollback: %w", err)
	}
	return nil
}

// PrepareVaultFromExport stages a vault for a sync restore without firing unlock callbacks.
//
//wails:ignore
func (s *SecurityService) PrepareVaultFromExport(password string, vault crypto.VaultFile) (VaultInstallTransaction, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	transaction, err := s.prepareVaultFromExport(password, vault)
	if err != nil {
		finish()
		return nil, err
	}
	transaction.finish = finish
	return transaction, nil
}

func (s *SecurityService) prepareVaultFromExport(password string, vault crypto.VaultFile) (*vaultInstallTransaction, error) {
	runtime, err := s.requireRuntime()
	if err != nil {
		return nil, err
	}
	s.stateMu.Lock()
	runtime.lockOperation()
	state, err := s.captureVaultInstallState(runtime)
	if err == nil {
		_, err = s.installVaultFromExportLocked(runtime, password, vault)
	}
	if err != nil {
		var restoreErr error
		if state.settings != nil {
			restoreErr = s.restoreVaultInstallState(runtime, state)
		}
		clearVaultInstallState(&state)
		runtime.unlockOperation()
		s.stateMu.Unlock()
		return nil, errors.Join(err, restoreErr)
	}
	status, statusErr := s.statusLocked()
	if statusErr != nil {
		restoreErr := s.restoreVaultInstallState(runtime, state)
		clearVaultInstallState(&state)
		runtime.unlockOperation()
		s.stateMu.Unlock()
		return nil, errors.Join(statusErr, restoreErr)
	}
	release := func() {
		runtime.unlockOperation()
		s.stateMu.Unlock()
	}
	return &vaultInstallTransaction{
		operation: func(operation func() error) error { return operation() },
		commit: func() error {
			clearVaultInstallState(&state)
			release()
			s.runAfterUnlock()
			s.emitVaultStatus(status)
			return nil
		},
		rollback: func() error {
			restoreErr := s.restoreVaultInstallState(runtime, state)
			clearVaultInstallState(&state)
			release()
			return restoreErr
		},
	}, nil
}
