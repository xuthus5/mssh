package service

import (
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

var systemInfoSnapshotTTL = time.Second

type systemInfoSnapshot struct {
	done      chan struct{}
	info      *model.SystemInfo
	err       error
	expiresAt time.Time
}

// loadSystemInfoSnapshot coalesces concurrent collectors for one terminal and
// keeps the result briefly so independent status widgets do not resample the
// same remote host.
func (t *TerminalService) loadSystemInfoSnapshot(terminalID string, collect func() (*model.SystemInfo, error)) (*model.SystemInfo, error) {
	now := time.Now()
	t.systemMu.Lock()
	if t.systemInfoSnapshots == nil {
		t.systemInfoSnapshots = make(map[string]*systemInfoSnapshot)
	}
	if snapshot := t.systemInfoSnapshots[terminalID]; snapshot != nil {
		if snapshot.expiresAt.After(now) || snapshot.expiresAt.IsZero() {
			t.systemMu.Unlock()
			<-snapshot.done
			return snapshot.info, snapshot.err
		}
	}
	snapshot := &systemInfoSnapshot{done: make(chan struct{})}
	t.systemInfoSnapshots[terminalID] = snapshot
	t.systemMu.Unlock()

	info, err := collect()
	t.systemMu.Lock()
	snapshot.info = info
	snapshot.err = err
	snapshot.expiresAt = time.Now().Add(systemInfoSnapshotTTL)
	if err != nil {
		if t.systemInfoSnapshots[terminalID] == snapshot {
			delete(t.systemInfoSnapshots, terminalID)
		}
	}
	t.systemMu.Unlock()
	close(snapshot.done)
	return info, err
}
