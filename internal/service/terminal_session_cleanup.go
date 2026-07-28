package service

import "fmt"

type terminalRegistration struct {
	terminalID, connID string
	sessionID          int64
	generation         uint64
	enforceGeneration  bool
	pty                terminalIO
}

// CloseForSessions closes active SSH terminals owned by the given sessions.
//
//wails:ignore
func (t *TerminalService) CloseForSessions(sessionIDs []int64) error {
	if t == nil || len(sessionIDs) == 0 {
		return nil
	}
	wanted := positiveSessionIDs(sessionIDs)
	if len(wanted) == 0 {
		return nil
	}

	t.mu.RLock()
	terminalIDs := make([]string, 0)
	seen := make(map[string]struct{})
	for terminalID, sessionID := range t.sessionIDs {
		if _, ok := wanted[sessionID]; ok {
			terminalIDs = append(terminalIDs, terminalID)
			seen[terminalID] = struct{}{}
		}
	}
	for terminalID, sessionID := range t.pendingSessionIDs {
		if _, ok := wanted[sessionID]; ok {
			if _, exists := seen[terminalID]; !exists {
				terminalIDs = append(terminalIDs, terminalID)
			}
		}
	}
	t.mu.RUnlock()

	return closeTerminalIDs(t, terminalIDs)
}

func (t *TerminalService) beginSessionDeletion(sessionIDs []int64) {
	wanted := positiveSessionIDs(sessionIDs)
	if t == nil || len(wanted) == 0 {
		return
	}
	t.mu.Lock()
	if t.blockedSessions == nil {
		t.blockedSessions = make(map[int64]int)
	}
	if t.sessionOpenGenerations == nil {
		t.sessionOpenGenerations = make(map[int64]uint64)
	}
	for sessionID := range wanted {
		t.blockedSessions[sessionID]++
		t.sessionOpenGenerations[sessionID]++
	}
	t.mu.Unlock()
}

func (t *TerminalService) endSessionDeletion(sessionIDs []int64) {
	wanted := positiveSessionIDs(sessionIDs)
	if t == nil || len(wanted) == 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	for sessionID := range wanted {
		if t.blockedSessions[sessionID] <= 1 {
			delete(t.blockedSessions, sessionID)
			continue
		}
		t.blockedSessions[sessionID]--
	}
}

func (t *TerminalService) beginSessionOpen(sessionID int64) (uint64, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.blockedSessions[sessionID] > 0 {
		return 0, fmt.Errorf("session deletion in progress for session %d", sessionID)
	}
	return t.sessionOpenGenerations[sessionID], nil
}

func (t *TerminalService) updatePendingSessionOwnerLocked(terminalID string, sessionID int64, retain bool) {
	if retain && sessionID > 0 {
		if t.pendingSessionIDs == nil {
			t.pendingSessionIDs = make(map[string]int64)
		}
		t.pendingSessionIDs[terminalID] = sessionID
		return
	}
	delete(t.pendingSessionIDs, terminalID)
}
