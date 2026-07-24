package service

import (
	"time"

	"github.com/xuthus5/mssh/pkg/event"
)

type evictedTerminal struct {
	terminalID   string
	pty          terminalIO
	connID       string
	closeHandler func(string)
}

func (t *TerminalService) evictLRU() {
	t.mu.Lock()
	evicted := t.detachLRUVictimLocked()
	t.mu.Unlock()
	t.finishEviction(evicted)
}

func (t *TerminalService) detachLRUVictimLocked() evictedTerminal {
	victimID := t.pickLRUVictimLocked()
	if victimID == "" {
		return evictedTerminal{}
	}

	dispatcher := t.lockOutputDispatcher(victimID)
	t.outputMu.Lock()
	evicted := evictedTerminal{
		terminalID:   victimID,
		pty:          t.ptys[victimID],
		connID:       t.connIDs[victimID],
		closeHandler: t.closeHandler,
	}
	delete(t.ptys, victimID)
	delete(t.lastUsed, victimID)
	delete(t.attached, victimID)
	delete(t.pendingOutput, victimID)
	delete(t.outputSequences, victimID)
	delete(t.connIDs, victimID)
	delete(t.sessionIDs, victimID)
	t.outputMu.Unlock()
	t.unlockOutputDispatcher(victimID, dispatcher)
	return evicted
}

func (t *TerminalService) finishEviction(evicted evictedTerminal) {
	if evicted.terminalID == "" {
		return
	}
	t.deleteSystemSample(evicted.terminalID)
	if evicted.pty != nil {
		if err := evicted.pty.Close(); err != nil {
			t.logger.Debug("evicted terminal close failed", "terminalID", evicted.terminalID, "error", err)
		}
	}
	t.releaseSerialDevice(evicted.terminalID, evicted.pty)
	if evicted.closeHandler != nil {
		evicted.closeHandler(evicted.terminalID)
	}
	if t.sessionSvc != nil && evicted.connID != "" {
		if err := t.sessionSvc.disconnect(evicted.connID, false); err != nil {
			t.logger.Debug("evicted terminal connection cleanup failed", "terminalID", evicted.terminalID, "error", err)
		}
	}
	t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{TerminalID: evicted.terminalID, State: "evicted"})
}

// pickLRUVictim prefers terminals that are not currently attached to the UI.
func (t *TerminalService) pickLRUVictim() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.pickLRUVictimLocked()
}

func (t *TerminalService) pickLRUVictimLocked() string {
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
