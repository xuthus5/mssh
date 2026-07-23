package service

import (
	"time"

	"github.com/xuthus5/mssh/pkg/event"
)

func (t *TerminalService) evictLRU() {
	victimID := t.pickLRUVictim()
	if victimID == "" {
		return
	}

	t.outputMu.Lock()
	pty := t.ptys[victimID]
	connID := t.connIDs[victimID]
	delete(t.ptys, victimID)
	delete(t.lastUsed, victimID)
	delete(t.attached, victimID)
	delete(t.pendingOutput, victimID)
	delete(t.systemSamples, victimID)
	delete(t.outputSequences, victimID)
	delete(t.connIDs, victimID)
	delete(t.sessionIDs, victimID)
	closeHandler := t.closeHandler
	t.outputMu.Unlock()

	if pty != nil {
		_ = pty.Close()
	}
	t.releaseSerialDevice(victimID, pty)
	if closeHandler != nil {
		closeHandler(victimID)
	}
	if t.sessionSvc != nil && connID != "" {
		_ = t.sessionSvc.disconnect(connID, false)
	}
	t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{TerminalID: victimID, State: "evicted"})
}

// pickLRUVictim prefers terminals that are not currently attached to the UI.
func (t *TerminalService) pickLRUVictim() string {
	var orphanID string
	var orphanTime time.Time
	var attachedID string
	var attachedTime time.Time
	for id, usedAt := range t.lastUsed {
		if !t.attached[id] {
			if orphanID == "" || usedAt.Before(orphanTime) {
				orphanID = id
				orphanTime = usedAt
			}
			continue
		}
		if attachedID == "" || usedAt.Before(attachedTime) {
			attachedID = id
			attachedTime = usedAt
		}
	}
	if orphanID != "" {
		return orphanID
	}
	return attachedID
}
