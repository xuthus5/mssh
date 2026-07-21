package service

import (
	"time"

	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func (f *FileService) recordStart(taskID string) {
	f.progress.Lock()
	f.startsAt[taskID] = time.Now()
	f.progress.Unlock()
}

func (f *FileService) clearStart(taskID string) {
	f.progress.Lock()
	delete(f.startsAt, taskID)
	delete(f.lastProgressPersist, taskID)
	delete(f.lastProgressBytes, taskID)
	f.progress.Unlock()
}

// reportProgress calculates percent, speed, and ETA, then emits a progress event.
func (f *FileService) reportProgress(taskID string, transferred, total int64) {
	percent := float64(0)
	if total > 0 {
		percent = float64(transferred) / float64(total) * 100
	}

	var speed int64
	var eta int64
	f.progress.Lock()
	start, ok := f.startsAt[taskID]
	f.progress.Unlock()
	if ok {
		elapsed := time.Since(start).Seconds()
		if elapsed > 0 {
			speed = int64(float64(transferred) / elapsed)
			if speed > 0 && total > 0 {
				remaining := total - transferred
				eta = int64(float64(remaining) / float64(speed))
			}
		}
	}

	f.eventBus.Emit(event.TransferProgress, event.TransferProgressPayload{
		TaskID:      taskID,
		Status:      "running",
		Transferred: transferred,
		Total:       total,
		Percent:     percent,
		Speed:       speed,
		ETA:         eta,
	})
	if f.db != nil && f.shouldPersistTransferProgress(taskID, transferred, total) {
		if err := store.UpdateTransferProgress(f.db, taskID, transferred, total, speed, eta); err != nil {
			f.logger.Error("persist transfer progress failed", "taskID", taskID, "error", err)
		}
	}
}

func (f *FileService) shouldPersistTransferProgress(taskID string, transferred, total int64) bool {
	f.progress.Lock()
	defer f.progress.Unlock()
	if total > 0 && transferred >= total {
		f.lastProgressPersist[taskID] = time.Now()
		f.lastProgressBytes[taskID] = transferred
		return true
	}
	lastAt, seen := f.lastProgressPersist[taskID]
	lastBytes := f.lastProgressBytes[taskID]
	if !seen {
		f.lastProgressPersist[taskID] = time.Now()
		f.lastProgressBytes[taskID] = transferred
		return true
	}
	if time.Since(lastAt) < transferProgressPersistMinInterval && transferred-lastBytes < transferProgressPersistMinDelta {
		return false
	}
	f.lastProgressPersist[taskID] = time.Now()
	f.lastProgressBytes[taskID] = transferred
	return true
}

// emitTransferError emits a transfer error event with the error message.
func (f *FileService) emitTransferError(taskID string, err error) {
	f.finishTransfer(taskID, "failed", err.Error())
	f.eventBus.Emit(event.TransferError, event.TransferErrorPayload{
		TaskID: taskID,
		Status: "failed",
		Error:  err.Error(),
	})
}

func (f *FileService) emitTransferCancelled(taskID string) {
	f.finishTransfer(taskID, "cancelled", "")
	f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{
		TaskID: taskID,
		Status: "cancelled",
	})
}
