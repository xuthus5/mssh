package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

var errFileServiceStopped = errors.New("file service is shutting down")

func (f *FileService) beginOperation() (func(), error) {
	if f == nil {
		return nil, errFileServiceStopped
	}
	f.mu.Lock()
	if f.stopping || f.shuttingDown {
		f.mu.Unlock()
		return nil, errFileServiceStopped
	}
	f.operationWG.Add(1)
	f.mu.Unlock()
	var finishOnce sync.Once
	return func() { finishOnce.Do(f.operationWG.Done) }, nil
}

func (f *FileService) registerTask(taskID string, sessionID int64, cancel context.CancelFunc) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stopping || f.shuttingDown {
		return fmt.Errorf("file service is shutting down")
	}
	if f.maxQueuedTransfers > 0 && len(f.tasks) >= f.maxQueuedTransfers {
		return errTransferQueueFull
	}
	if f.taskRuntimes == nil {
		f.taskRuntimes = make(map[string]*transferTaskRuntime)
	}
	f.tasks[taskID] = cancel
	f.taskSessions[taskID] = sessionID
	f.taskRuntimes[taskID] = newTransferTaskRuntime()
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
	delete(f.taskRuntimes, taskID)
	f.mu.Unlock()
}

// WaitForTransfers waits until all started transfer workers release their resources.
//
//wails:ignore
func (f *FileService) WaitForTransfers() {
	if f == nil {
		return
	}
	f.workers.Wait()
}

type transferCancellation struct {
	taskID  string
	cancel  context.CancelFunc
	closer  func() error
	runtime *transferTaskRuntime
}

func (f *FileService) cancelTaskLocked(taskID string) (transferCancellation, bool) {
	cancel, ok := f.tasks[taskID]
	if !ok {
		return transferCancellation{}, false
	}
	return transferCancellation{
		taskID:  taskID,
		cancel:  cancel,
		closer:  f.taskClosers[taskID],
		runtime: f.taskRuntimes[taskID],
	}, true
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
		_ = f.cancelRegisteredTransfer(item)
	}
}

func (f *FileService) quiesce(permanent bool) {
	if f == nil {
		return
	}
	f.closeMu.Lock()
	f.mu.Lock()
	f.stopping = true
	if permanent {
		f.shuttingDown = true
	}
	cancellations := f.cancellationSnapshotLocked()
	f.mu.Unlock()
	f.closeCancelledTasks(cancellations)
	f.workers.Wait()
	f.operationWG.Wait()
	f.reconcilePendingTransferFinalizations()
	f.mu.Lock()
	if !permanent && !f.shuttingDown {
		f.stopping = false
	}
	f.mu.Unlock()
	f.closeMu.Unlock()
}

// PauseAndWait temporarily blocks new transfers until active workers stop.
//
//wails:ignore
func (f *FileService) PauseAndWait() {
	f.quiesce(false)
}

// StopAndWait permanently rejects new transfers and waits for cleanup.
//
//wails:ignore
func (f *FileService) StopAndWait() {
	f.quiesce(true)
}
