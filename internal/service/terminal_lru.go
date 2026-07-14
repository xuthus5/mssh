package service

import (
	"time"

	"github.com/xuthus5/mssh/pkg/event"
)

func (t *TerminalService) evictLRU() {
	var oldestID string
	var oldestTime time.Time
	for id, usedAt := range t.lastUsed {
		if oldestID == "" || usedAt.Before(oldestTime) {
			oldestID = id
			oldestTime = usedAt
		}
	}
	if oldestID == "" {
		return
	}

	t.outputMu.Lock()
	pty := t.ptys[oldestID]
	connID := t.connIDs[oldestID]
	delete(t.ptys, oldestID)
	delete(t.lastUsed, oldestID)
	delete(t.attached, oldestID)
	delete(t.pendingOutput, oldestID)
	delete(t.connIDs, oldestID)
	if pty != nil {
		_ = pty.Close()
	}
	if t.closeHandler != nil {
		t.closeHandler(oldestID)
	}
	if t.sessionSvc != nil && connID != "" {
		_ = t.sessionSvc.disconnect(connID, false)
	}
	t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{TerminalID: oldestID, State: "evicted"})
	t.outputMu.Unlock()
}
