package service

import (
	"context"
	"errors"
	"fmt"
)

func (s *SessionService) beginConnect(ctx context.Context, sessionID int64) (context.Context, string, func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	connectCtx, cancel := context.WithCancel(ctx)
	attemptID := generateConnectionAttemptID()
	s.mu.Lock()
	if s.closing || s.shuttingDown {
		s.mu.Unlock()
		cancel()
		return nil, "", nil, fmt.Errorf("session service is shutting down")
	}
	if s.attempts == nil {
		s.attempts = make(map[string]*connectAttempt)
	}
	s.attempts[attemptID] = &connectAttempt{
		cancel: cancel, decision: make(chan bool, 1), sessionID: sessionID,
	}
	s.connectWG.Add(1)
	s.mu.Unlock()

	finish := func() {
		s.finishConnectAttempt(attemptID)
		s.connectWG.Done()
	}
	return connectCtx, attemptID, finish, nil
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
	s.mu.Lock()
	s.closing = true
	if permanent {
		s.shuttingDown = true
	}
	cancels := s.cancelConnectAttemptsLocked()
	s.mu.Unlock()
	cancelConnectAttempts(cancels)
	s.connectWG.Wait()

	connections := s.takeConnections()
	closeErr := closeManagedConnections(connections)
	s.mu.Lock()
	if !permanent && !s.shuttingDown {
		s.closing = false
	}
	s.mu.Unlock()
	s.closeMu.Unlock()
	return closeErr
}

func (s *SessionService) takeConnections() map[string]*managedConn {
	s.mu.Lock()
	connections := make(map[string]*managedConn, len(s.conns))
	for id, conn := range s.conns {
		connections[id] = conn
	}
	s.conns = make(map[string]*managedConn)
	s.mu.Unlock()
	return connections
}

func closeManagedConnections(connections map[string]*managedConn) error {
	var closeErr error
	for id, conn := range connections {
		if conn == nil {
			continue
		}
		if conn.cleanup != nil {
			conn.cleanup()
		}
		if conn.wrapper == nil {
			continue
		}
		if err := conn.wrapper.Close(); err != nil {
			closeErr = errors.Join(closeErr, fmt.Errorf("close connection %s: %w", id, err))
		}
	}
	return closeErr
}

// Shutdown permanently rejects new connections and closes established connections.
//
//wails:ignore
func (s *SessionService) Shutdown() error {
	if s == nil {
		return nil
	}
	return s.closeAll(true)
}
