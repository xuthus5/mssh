package service

// SessionTunnelStopper stops live tunnels belonging to sessions about to be deleted.
type SessionTunnelStopper interface {
	StopForSessions(sessionIDs []int64)
}

// SetTunnelStopper wires live tunnel cleanup before session rows are removed.
//
//wails:ignore
func (s *SessionService) SetTunnelStopper(stopper SessionTunnelStopper) {
	s.tunnels = stopper
}

func (s *SessionService) stopTunnelsForSessions(sessionIDs []int64) {
	if s.tunnels == nil || len(sessionIDs) == 0 {
		return
	}
	s.tunnels.StopForSessions(sessionIDs)
}
