package service

// CloseForSessions closes active SSH terminals owned by the given sessions.
//
//wails:ignore
func (t *TerminalService) CloseForSessions(sessionIDs []int64) {
	if t == nil || len(sessionIDs) == 0 {
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

	t.mu.RLock()
	terminalIDs := make([]string, 0)
	for terminalID, sessionID := range t.sessionIDs {
		if _, ok := wanted[sessionID]; ok {
			terminalIDs = append(terminalIDs, terminalID)
		}
	}
	t.mu.RUnlock()

	for _, terminalID := range terminalIDs {
		if err := t.Close(terminalID); err != nil {
			t.logger.Debug("close terminal for deleted session", "terminalID", terminalID, "error", err)
		}
	}
}
