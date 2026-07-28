package service

import (
	"errors"
	"sync"
)

var errSecurityServiceStopped = errors.New("security service is shutting down")

type securityServiceLifecycle struct {
	mu      sync.Mutex
	workers sync.WaitGroup
	stopped bool
}

func (s *SecurityService) beginOperation() (func(), error) {
	if s == nil {
		return nil, errSecurityServiceStopped
	}
	s.lifecycle.mu.Lock()
	if s.lifecycle.stopped {
		s.lifecycle.mu.Unlock()
		return nil, errSecurityServiceStopped
	}
	s.lifecycle.workers.Add(1)
	s.lifecycle.mu.Unlock()
	return s.lifecycle.workers.Done, nil
}

// Shutdown rejects new security operations, waits for active calls, and clears the DEK.
//
//wails:ignore
func (s *SecurityService) Shutdown() {
	if s == nil {
		return
	}
	s.lifecycle.mu.Lock()
	s.lifecycle.stopped = true
	s.lifecycle.mu.Unlock()
	s.lifecycle.workers.Wait()
	s.ClearMemory()
}

// ClearMemory drops the in-process DEK without changing keychain preferences.
//
//wails:ignore
func (s *SecurityService) ClearMemory() {
	if s == nil {
		return
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	_ = s.clearDEK()
}
