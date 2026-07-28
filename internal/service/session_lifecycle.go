package service

import (
	"context"
	"errors"
	"fmt"
)

func (s *SessionService) beginConnect(ctx context.Context, sessionID int64) (context.Context, string, uint64, func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	connectCtx, cancel := context.WithCancel(ctx)
	attemptID := generateConnectionAttemptID()
	s.mu.Lock()
	if s.closing || s.shuttingDown {
		s.mu.Unlock()
		cancel()
		return nil, "", 0, nil, fmt.Errorf("session service is shutting down")
	}
	if err := s.sessionRuntimeErrorLocked(sessionID, s.sessionDeletionGenerationLocked(sessionID)); err != nil {
		s.mu.Unlock()
		cancel()
		return nil, "", 0, nil, err
	}
	generation := s.sessionDeletionGenerationLocked(sessionID)
	if s.attempts == nil {
		s.attempts = make(map[string]*connectAttempt)
	}
	s.attempts[attemptID] = &connectAttempt{
		cancel: cancel, decision: make(chan bool, 1), sessionID: sessionID, generation: generation,
	}
	s.connectWG.Add(1)
	s.mu.Unlock()

	finish := func() {
		s.finishConnectAttempt(attemptID)
		s.connectWG.Done()
	}
	return connectCtx, attemptID, generation, finish, nil
}

func (s *SessionService) cancelConnectAttemptsLocked() []context.CancelFunc {
	cancels := make([]context.CancelFunc, 0, len(s.attempts))
	for attemptID, attempt := range s.attempts {
		if attempt != nil && attempt.cancel != nil {
			cancels = append(cancels, attempt.cancel)
		}
		delete(s.attempts, attemptID)
	}
	return cancels
}

func cancelConnectAttempts(cancels []context.CancelFunc) {
	for _, cancel := range cancels {
		cancel()
	}
}

// CancelConnectAttempts aborts all in-flight connection attempts without closing established connections.
//
//wails:ignore
func (s *SessionService) CancelConnectAttempts() {
	if s == nil {
		return
	}
	s.mu.Lock()
	cancels := s.cancelConnectAttemptsLocked()
	s.mu.Unlock()
	cancelConnectAttempts(cancels)
}

func (s *SessionService) closeAll(permanent bool) error {
	s.closeMu.Lock()
	defer s.closeMu.Unlock()
	s.mu.Lock()
	s.closing = true
	if permanent {
		s.shuttingDown = true
	}
	cancels := s.cancelConnectAttemptsLocked()
	s.mu.Unlock()
	cancelConnectAttempts(cancels)
	s.connectWG.Wait()

	connections := s.snapshotConnections()
	closeErr := s.closeManagedConnections(connections)
	s.mu.Lock()
	if !permanent && !s.shuttingDown {
		s.closing = false
	}
	s.mu.Unlock()
	return closeErr
}

func (s *SessionService) snapshotConnections() map[string]*managedConn {
	s.mu.RLock()
	defer s.mu.RUnlock()
	connections := make(map[string]*managedConn, len(s.conns))
	for id, conn := range s.conns {
		connections[id] = conn
	}
	return connections
}

func (s *SessionService) closeManagedConnections(connections map[string]*managedConn) error {
	var closeErr error
	for id, conn := range connections {
		if err := conn.closeConnection(); err != nil {
			closeErr = errors.Join(closeErr, fmt.Errorf("close connection %s: %w", id, err))
			continue
		}
		s.removeConnectionIfOwned(id, conn)
	}
	return closeErr
}

func (s *SessionService) removeConnectionIfOwned(id string, conn *managedConn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	registeredConn, registered := s.conns[id]
	if !registered || registeredConn != conn {
		return false
	}
	delete(s.conns, id)
	return true
}

// Shutdown permanently rejects new connections and closes established connections.
//
//wails:ignore
func (s *SessionService) Shutdown() error {
	if s == nil {
		return nil
	}
	s.StopOperationsAndWait()
	return s.closeAll(true)
}
