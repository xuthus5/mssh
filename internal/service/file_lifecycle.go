package service

import (
	"context"
	"fmt"
)

func (f *FileService) registerTask(taskID string, sessionID int64, cancel context.CancelFunc) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stopping {
		return fmt.Errorf("file service is shutting down")
	}
	f.tasks[taskID] = cancel
	f.taskSessions[taskID] = sessionID
	f.workers.Add(1)
	return nil
}

func (f *FileService) attachTaskCloser(taskID string, ctx context.Context, closer func() error) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stopping || ctx.Err() != nil {
		return false
	}
	if _, ok := f.tasks[taskID]; !ok {
		return false
	}
	f.taskClosers[taskID] = closer
	return true
}

func (f *FileService) removeTask(taskID string) {
	f.mu.Lock()
	delete(f.tasks, taskID)
	delete(f.taskClosers, taskID)
	delete(f.taskSessions, taskID)
	f.mu.Unlock()
}

// WaitForTransfers waits until all started transfer workers release their resources.
func (f *FileService) WaitForTransfers() {
	if f == nil {
		return
	}
	f.workers.Wait()
}

type transferCancellation struct {
	taskID string
	closer func() error
}

func (f *FileService) cancelTaskLocked(taskID string) (transferCancellation, bool) {
	cancel, ok := f.tasks[taskID]
	if !ok {
		return transferCancellation{}, false
	}
	cancel()
	return transferCancellation{taskID: taskID, closer: f.taskClosers[taskID]}, true
}

func (f *FileService) cancellationSnapshotLocked() []transferCancellation {
	cancellations := make([]transferCancellation, 0, len(f.tasks))
	for taskID := range f.tasks {
		cancellation, _ := f.cancelTaskLocked(taskID)
		cancellations = append(cancellations, cancellation)
	}
	return cancellations
}

func (f *FileService) closeCancelledTasks(cancellations []transferCancellation) {
	for _, item := range cancellations {
		f.closeCancelledTask(item)
	}
}

func (f *FileService) closeCancelledTask(cancellation transferCancellation) {
	if cancellation.closer == nil {
		return
	}
	if err := cancellation.closer(); err != nil {
		f.logger.Debug("cancel transfer transport close failed", "taskID", cancellation.taskID, "error", err)
	}
}

// StopAndWait prevents new transfers, cancels active work, and waits for cleanup.
//
//wails:ignore
func (f *FileService) StopAndWait() {
	if f == nil {
		return
	}
	f.mu.Lock()
	f.stopping = true
	cancellations := f.cancellationSnapshotLocked()
	f.mu.Unlock()
	f.closeCancelledTasks(cancellations)
	f.workers.Wait()
}
