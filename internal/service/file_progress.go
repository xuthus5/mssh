package service

import (
	"errors"
	"time"

	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

const transferSpeedSampleWindow = time.Second

type transferSpeedSample struct {
	at    time.Time
	bytes int64
	speed int64
}

func (f *FileService) recordStart(taskID string) {
	startedAt := time.Now()
	f.progress.Lock()
	f.startsAt[taskID] = startedAt
	if f.speedSamples == nil {
		f.speedSamples = make(map[string]transferSpeedSample)
	}
	f.speedSamples[taskID] = transferSpeedSample{at: startedAt}
	f.progress.Unlock()
}

func (f *FileService) clearStart(taskID string) {
	f.progress.Lock()
	delete(f.startsAt, taskID)
	delete(f.speedSamples, taskID)
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

	now := time.Now()
	var speed int64
	f.progress.Lock()
	_, ok := f.startsAt[taskID]
	if ok {
		sample := f.speedSamples[taskID]
		speed, sample = nextTransferSpeed(sample, now, transferred)
		if f.speedSamples == nil {
			f.speedSamples = make(map[string]transferSpeedSample)
		}
		f.speedSamples[taskID] = sample
	}
	f.progress.Unlock()
	var eta int64
	if speed > 0 && total > transferred {
		eta = int64(float64(total-transferred) / float64(speed))
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

func nextTransferSpeed(sample transferSpeedSample, now time.Time, transferred int64) (int64, transferSpeedSample) {
	if sample.at.IsZero() {
		return 0, transferSpeedSample{at: now, bytes: transferred}
	}
	elapsed := now.Sub(sample.at)
	if elapsed < transferSpeedSampleWindow {
		return sample.speed, sample
	}
	delta := transferred - sample.bytes
	if delta < 0 {
		delta = 0
	}
	speed := int64(float64(delta) / elapsed.Seconds())
	return speed, transferSpeedSample{at: now, bytes: transferred, speed: speed}
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
	f.finishTransfer(transferFinalization{taskID: taskID, status: "failed", errorMessage: err.Error()})
	f.eventBus.Emit(event.TransferError, event.TransferErrorPayload{
		TaskID: taskID,
		Status: "failed",
		Error:  err.Error(),
	})
}

func (f *FileService) emitTransferCancelled(taskID string, errs ...error) {
	errorMessage := ""
	if err := errors.Join(errs...); err != nil {
		errorMessage = err.Error()
	}
	f.finishTransfer(transferFinalization{taskID: taskID, status: "cancelled", errorMessage: errorMessage})
	f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{
		TaskID: taskID,
		Status: "cancelled",
	})
}

func (f *FileService) emitTransferCompleted(taskID string, transferred, total int64) {
	f.finishTransfer(transferFinalization{
		taskID: taskID, status: "completed", transferred: transferred, total: total,
	})
	f.eventBus.Emit(event.TransferComplete, event.TransferProgressPayload{
		TaskID: taskID, Status: "completed", Transferred: transferred, Total: total, Percent: 100,
	})
}
