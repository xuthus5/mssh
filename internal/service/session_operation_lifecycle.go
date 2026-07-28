package service

import "errors"

var errSessionServiceStopped = errors.New("session service is shutting down")

func (s *SessionService) beginOperation() (func(), error) {
	if s == nil {
		return nil, errSessionServiceStopped
	}
	return s.lifecycle.begin(errSessionServiceStopped)
}

// StopOperationsAndWait rejects new session operations, cancels connection attempts,
// and waits for active database, filesystem, crypto, and connection work.
//
//wails:ignore
func (s *SessionService) StopOperationsAndWait() {
	if s == nil {
		return
	}
	s.lifecycle.stop()
	s.mu.Lock()
	s.shuttingDown = true
	cancels := s.cancelConnectAttemptsLocked()
	s.mu.Unlock()
	cancelConnectAttempts(cancels)
	s.lifecycle.wait()
}
