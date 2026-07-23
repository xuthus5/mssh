package service

// DisconnectForSessions closes any remaining SSH client wrappers owned by the sessions.
//
//wails:ignore
func (s *SessionService) DisconnectForSessions(sessionIDs []int64) {
	if s == nil || len(sessionIDs) == 0 {
		return
	}
	wanted := make(map[int64]struct{}, len(sessionIDs))
	for _, sessionID := range sessionIDs {
		if sessionID > 0 {
			wanted[sessionID] = struct{}{}
		}
	}
	if len(wanted) == 0 {
		return
	}

	s.mu.Lock()
	connIDs := make([]string, 0)
	for connID, conn := range s.conns {
		if conn == nil {
			continue
		}
		if _, ok := wanted[conn.sessionID]; ok {
			connIDs = append(connIDs, connID)
		}
	}
	s.mu.Unlock()

	for _, connID := range connIDs {
		if err := s.disconnect(connID, false); err != nil {
			s.logger.Debug("disconnect residual session connection", "connID", connID, "error", err)
		}
	}
}
