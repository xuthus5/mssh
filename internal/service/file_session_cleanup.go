package service

import "github.com/xuthus5/mssh/internal/store"

// CancelForSessions cancels in-flight transfers owned by sessions about to be deleted.
//
//wails:ignore
func (f *FileService) CancelForSessions(sessionIDs []int64) {
	if f == nil || len(sessionIDs) == 0 {
		return
	}
	wanted := positiveSessionIDs(sessionIDs)
	if len(wanted) == 0 {
		return
	}
	persistSessionCancellations(f, sessionIDs)
	cancellations := f.sessionCancellationSnapshot(wanted)
	f.closeCancelledTasks(cancellations)
}

func positiveSessionIDs(sessionIDs []int64) map[int64]struct{} {
	wanted := make(map[int64]struct{}, len(sessionIDs))
	for _, sessionID := range sessionIDs {
		if sessionID > 0 {
			wanted[sessionID] = struct{}{}
		}
	}
	return wanted
}

func persistSessionCancellations(f *FileService, sessionIDs []int64) {
	if f.db == nil {
		return
	}
	if err := store.CancelTransferJobsForSessions(f.db, sessionIDs); err != nil {
		f.logger.Error("cancel transfer jobs for deleted sessions failed", "error", err)
	}
}

func (f *FileService) sessionCancellationSnapshot(wanted map[int64]struct{}) []transferCancellation {
	f.mu.Lock()
	defer f.mu.Unlock()
	cancellations := make([]transferCancellation, 0)
	for taskID := range f.tasks {
		sessionID, ok := f.taskSessions[taskID]
		if !ok {
			continue
		}
		if _, ok := wanted[sessionID]; !ok {
			continue
		}
		cancellation, _ := f.cancelTaskLocked(taskID)
		cancellations = append(cancellations, cancellation)
	}
	return cancellations
}
