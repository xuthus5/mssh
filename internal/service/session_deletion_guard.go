package service

import "fmt"

func (s *SessionService) beginSessionDeletion(sessionIDs []int64) func() {
	wanted := positiveSessionIDs(sessionIDs)
	if s == nil || len(wanted) == 0 {
		return func() {}
	}
	s.mu.Lock()
	if s.deletions == nil {
		s.deletions = make(map[int64]sessionDeletionState)
	}
	for sessionID := range wanted {
		state := s.deletions[sessionID]
		state.active++
		state.generation++
		s.deletions[sessionID] = state
	}
	cancels := s.cancelConnectAttemptsForSessionsLocked(wanted)
	s.mu.Unlock()
	cancelConnectAttempts(cancels)
	return func() { s.endSessionDeletion(wanted) }
}

func (s *SessionService) endSessionDeletion(wanted map[int64]struct{}) {
	if s == nil || len(wanted) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for sessionID := range wanted {
		state, exists := s.deletions[sessionID]
		if !exists || state.active <= 1 {
			if exists {
				state.active = 0
				s.deletions[sessionID] = state
			}
			continue
		}
		state.active--
		s.deletions[sessionID] = state
	}
}

func (s *SessionService) sessionDeletionGenerationLocked(sessionID int64) uint64 {
	return s.deletions[sessionID].generation
}

func (s *SessionService) sessionRuntimeErrorLocked(sessionID int64, generation uint64) error {
	state := s.deletions[sessionID]
	if state.active > 0 {
		return fmt.Errorf("session deletion in progress for session %d", sessionID)
	}
	if state.generation != generation {
		return fmt.Errorf("session changed during connection for session %d", sessionID)
	}
	return nil
}

func (s *SessionService) registerConnectedSession(sessionID int64, generation uint64, conn *managedConn) (string, error) {
	if conn == nil {
		return "", fmt.Errorf("connection state is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.sessionRuntimeErrorLocked(sessionID, generation); err != nil {
		return "", err
	}
	if s.closing || s.shuttingDown {
		return "", fmt.Errorf("session service is shutting down")
	}
	terminalID := generateTerminalID()
	conn.sessionID = sessionID
	s.conns[terminalID] = conn
	return terminalID, nil
}
