package service

func (t *TunnelService) beginSessionDeletion(sessionIDs []int64) {
	wanted := positiveTunnelSessionIDs(sessionIDs)
	if len(wanted) == 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.blockedSessions == nil {
		t.blockedSessions = make(map[int64]int)
	}
	for sessionID := range wanted {
		t.blockedSessions[sessionID]++
	}
}

func (t *TunnelService) endSessionDeletion(sessionIDs []int64) {
	wanted := positiveTunnelSessionIDs(sessionIDs)
	if len(wanted) == 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	for sessionID := range wanted {
		if t.blockedSessions[sessionID] > 1 {
			t.blockedSessions[sessionID]--
			continue
		}
		delete(t.blockedSessions, sessionID)
	}
}
