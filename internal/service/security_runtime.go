package service

import "github.com/xuthus5/mssh/internal/model"

// SetEventBus wires lock notifications for the frontend VaultGate.
//
//wails:ignore
func (s *SecurityService) SetEventBus(bus EventBus) {
	s.callbackMu.Lock()
	defer s.callbackMu.Unlock()
	s.eventBus = bus
}

// SetAfterUnlock registers a callback invoked after vault DEK becomes available.
//
//wails:ignore
func (s *SecurityService) SetAfterUnlock(hook func()) {
	s.callbackMu.Lock()
	defer s.callbackMu.Unlock()
	s.afterUnlock = hook
}

func (s *SecurityService) runAfterUnlock() {
	s.callbackMu.RLock()
	hook := s.afterUnlock
	s.callbackMu.RUnlock()
	if hook == nil {
		return
	}
	hook()
}

func (s *SecurityService) emitVaultStatus(status model.SecurityStatus) {
	s.callbackMu.RLock()
	bus := s.eventBus
	s.callbackMu.RUnlock()
	if bus == nil {
		return
	}
	bus.Emit(securityVaultChangedEvent, status)
}

func (s *SecurityService) emitVaultLocked() {
	s.callbackMu.RLock()
	bus := s.eventBus
	s.callbackMu.RUnlock()
	if bus != nil {
		bus.Emit(securityVaultLockedEvent, map[string]any{"locked": true})
	}
}

// RequireUnlocked returns a stable error when the application vault is locked.
//
//wails:ignore
func (s *SecurityService) RequireUnlocked() error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	runtime, err := s.requireRuntime()
	if err != nil {
		return err
	}
	return runtime.RequireUnlocked()
}

func (s *SecurityService) requireRuntime() (*CryptoRuntime, error) {
	if s == nil || s.runtime == nil {
		return nil, ErrVaultLocked
	}
	return s.runtime, nil
}

func (s *SecurityService) runtimeUnlocked() bool {
	runtime, err := s.requireRuntime()
	return err == nil && runtime.Unlocked()
}
