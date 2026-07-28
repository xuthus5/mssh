package service

// SessionTerminalCloser closes live SSH terminals belonging to sessions about to be deleted.
type SessionTerminalCloser interface {
	CloseForSessions(sessionIDs []int64) error
}

type sessionTerminalDeletionGuard interface {
	beginSessionDeletion(sessionIDs []int64)
	endSessionDeletion(sessionIDs []int64)
}

// SetTerminalCloser wires terminal cleanup before session rows are removed.
//
//wails:ignore
func (s *SessionService) SetTerminalCloser(closer SessionTerminalCloser) {
	s.terminals = closer
}

func (s *SessionService) closeTerminalsForSessions(sessionIDs []int64) error {
	if s.terminals == nil || len(sessionIDs) == 0 {
		return nil
	}
	return s.terminals.CloseForSessions(sessionIDs)
}

func (s *SessionService) guardTerminalOpensForDeletion(sessionIDs []int64) func() {
	guard, ok := s.terminals.(sessionTerminalDeletionGuard)
	if !ok {
		return func() {}
	}
	guard.beginSessionDeletion(sessionIDs)
	return func() { guard.endSessionDeletion(sessionIDs) }
}
