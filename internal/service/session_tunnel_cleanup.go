package service

// SessionTunnelStopper stops live tunnels belonging to sessions about to be deleted.
type SessionTunnelStopper interface {
	StopForSessions(sessionIDs []int64) error
}

type sessionTunnelDeletionGuard interface {
	beginSessionDeletion(sessionIDs []int64)
	endSessionDeletion(sessionIDs []int64)
}

// SetTunnelStopper wires live tunnel cleanup before session rows are removed.
//
//wails:ignore
func (s *SessionService) SetTunnelStopper(stopper SessionTunnelStopper) {
	s.tunnels = stopper
}

func (s *SessionService) stopTunnelsForSessions(sessionIDs []int64) error {
	if s.tunnels == nil || len(sessionIDs) == 0 {
		return nil
	}
	return s.tunnels.StopForSessions(sessionIDs)
}

func (s *SessionService) guardTunnelStartsForDeletion(sessionIDs []int64) func() {
	guard, ok := s.tunnels.(sessionTunnelDeletionGuard)
	if !ok {
		return func() {}
	}
	guard.beginSessionDeletion(sessionIDs)
	return func() { guard.endSessionDeletion(sessionIDs) }
}
