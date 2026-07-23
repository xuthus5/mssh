package service

import (
	"context"

	"github.com/xuthus5/mssh/internal/store"
)

// CancelForSessions cancels in-flight transfers owned by sessions about to be deleted.
//
//wails:ignore
func (f *FileService) CancelForSessions(sessionIDs []int64) {
	if f == nil || len(sessionIDs) == 0 {
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

	// Persist cancel reason before interrupting workers so empty finish messages cannot wipe it.
	if f.db != nil {
		if err := store.CancelTransferJobsForSessions(f.db, sessionIDs); err != nil {
			f.logger.Error("cancel transfer jobs for deleted sessions failed", "error", err)
		}
	}

	f.mu.Lock()
	cancels := make([]context.CancelFunc, 0)
	taskIDs := make([]string, 0)
	for taskID, cancel := range f.tasks {
		sessionID, ok := f.taskSessions[taskID]
		if !ok {
			continue
		}
		if _, match := wanted[sessionID]; !match {
			continue
		}
		cancels = append(cancels, cancel)
		taskIDs = append(taskIDs, taskID)
	}
	f.mu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
	// Emit cancelled immediately so transfer center converges even if workers exit with I/O noise.
	for _, taskID := range taskIDs {
		f.emitTransferCancelled(taskID)
	}
}
