package service

// SessionTerminalCloser closes live SSH terminals belonging to sessions about to be deleted.
type SessionTerminalCloser interface {
	CloseForSessions(sessionIDs []int64)
}

// SetTerminalCloser wires terminal cleanup before session rows are removed.
//
//wails:ignore
func (s *SessionService) SetTerminalCloser(closer SessionTerminalCloser) {
	s.terminals = closer
}

func (s *SessionService) closeTerminalsForSessions(sessionIDs []int64) {
	if s.terminals == nil || len(sessionIDs) == 0 {
		return
	}
	s.terminals.CloseForSessions(sessionIDs)
}
