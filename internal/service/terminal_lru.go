package service

import (
	"errors"
	"fmt"
	"time"
)

func (t *TerminalService) evictLRU() {
	t.resourceMu.Lock()
	t.mu.Lock()
	victimID := t.pickLRUVictimLocked()
	t.mu.Unlock()
	var err error
	if victimID != "" {
		err = t.closeTerminalStateLocked(victimID, true, "evicted")
	}
	t.resourceMu.Unlock()
	if err != nil {
		t.logger.Debug("evicted terminal cleanup failed", "terminalID", victimID, "error", err)
	}
}

func (t *TerminalService) reduceTerminalCountLocked(maxCount int) error {
	attempted := make(map[string]struct{})
	var evictionErr error
	for t.Count() > maxCount {
		victimID := t.pickLRUVictimExcluding(attempted)
		if victimID == "" {
			break
		}
		attempted[victimID] = struct{}{}
		if err := t.closeTerminalStateLocked(victimID, true, "evicted"); err != nil {
			evictionErr = errors.Join(evictionErr, fmt.Errorf("evict terminal %s: %w", victimID, err))
		}
	}
	if count := t.Count(); count > maxCount {
		evictionErr = errors.Join(evictionErr, fmt.Errorf("terminal pool has %d resources, target is %d", count, maxCount))
	}
	return evictionErr
}

func (t *TerminalService) pickLRUVictimExcluding(excluded map[string]struct{}) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.pickLRUVictimExcludingLocked(excluded)
}

// pickLRUVictim prefers terminals that are not currently attached to the UI.
func (t *TerminalService) pickLRUVictim() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.pickLRUVictimLocked()
}

func (t *TerminalService) pickLRUVictimLocked() string {
	return t.pickLRUVictimExcludingLocked(nil)
}

func (t *TerminalService) pickLRUVictimExcludingLocked(excluded map[string]struct{}) string {
	for id := range t.lastUsed {
		if _, active := t.ptys[id]; !active {
			delete(t.lastUsed, id)
		}
	}
	var orphanID string
	var orphanTime time.Time
	var attachedID string
	var attachedTime time.Time
	for id := range t.ptys {
		if _, skip := excluded[id]; skip {
			continue
		}
		usedAt := t.lastUsed[id]
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

//wails:ignore
func (t *TerminalService) Count() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.ptys)
}

//wails:ignore
func (t *TerminalService) MaxSize() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.maxSize
}

func (t *TerminalService) SetMaxSize(maxSize int) error {
	if maxSize <= 0 {
		return fmt.Errorf("max terminal pool size must be greater than zero")
	}
	finish, err := t.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	t.resourceMu.Lock()
	t.mu.Lock()
	t.maxSize = maxSize
	t.mu.Unlock()
	err = t.reduceTerminalCountLocked(maxSize)
	t.resourceMu.Unlock()
	return err
}
