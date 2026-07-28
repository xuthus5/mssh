package service

import (
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	transferFinalizationUnknownPriority = iota
	transferFinalizationFailedPriority
	transferFinalizationCompletedPriority
	transferFinalizationCancelledPriority
)

type transferFinalization struct {
	taskID       string
	status       string
	errorMessage string
	transferred  int64
	total        int64
	completedAt  time.Time
}

func (f *FileService) finishTransfer(finalization transferFinalization) {
	if f.db == nil {
		return
	}
	finalization = normalizeTransferFinalization(finalization)
	if finalization.completedAt.IsZero() {
		finalization.completedAt = time.Now().UTC()
	}
	if err := f.persistTransferFinalization(finalization); err != nil {
		journalErr := f.rememberTransferFinalization(finalization)
		f.logTransferFinalizationError("persist transfer completion failed", finalization, err)
		f.logTransferFinalizationError("persist transfer finalization journal failed", finalization, journalErr)
		return
	}
	if err := f.clearTransferFinalization(finalization); err != nil {
		f.logTransferFinalizationError("clear transfer finalization journal failed", finalization, err)
	}
}

func normalizeTransferFinalization(finalization transferFinalization) transferFinalization {
	if finalization.status == "completed" {
		finalization.errorMessage = ""
		return finalization
	}
	finalization.errorMessage = sanitizeTransferFinalizationErrorMessage(finalization.errorMessage)
	return finalization
}

func (f *FileService) persistTransferFinalization(finalization transferFinalization) error {
	if err := f.persistTransferFinalizationBase(finalization); err != nil {
		return err
	}
	return f.promoteTransferFinalization(finalization)
}

func (f *FileService) persistTransferFinalizationBase(finalization transferFinalization) error {
	if finalization.status == "completed" {
		completedAt := finalization.completedAt
		return store.FinishTransferJobWithProgress(f.db, model.TransferJob{
			ID: finalization.taskID, Status: finalization.status, Error: finalization.errorMessage,
			TransferredBytes: finalization.transferred, TotalBytes: finalization.total, CompletedAt: &completedAt,
		})
	}
	return store.FinishTransferJob(f.db, finalization.taskID, finalization.status, finalization.errorMessage)
}

func (f *FileService) promoteTransferFinalization(finalization transferFinalization) error {
	switch finalization.status {
	case "completed":
		return f.promoteCompletedTransferFinalization(finalization)
	case "cancelled":
		return f.promoteCancelledTransferFinalization(finalization)
	default:
		return nil
	}
}

func (f *FileService) promoteCompletedTransferFinalization(finalization transferFinalization) error {
	_, err := f.db.Exec(`UPDATE transfer_jobs SET status='completed', error=?, transferred_bytes=?, total_bytes=?,
		speed=0, eta=0, completed_at=? WHERE id=? AND status='failed'`,
		finalization.errorMessage, finalization.transferred, finalization.total,
		finalization.completedAt.UTC().Format(time.RFC3339Nano), finalization.taskID)
	if err != nil {
		return fmt.Errorf("promote completed transfer finalization: %w", err)
	}
	return nil
}

func (f *FileService) promoteCancelledTransferFinalization(finalization transferFinalization) error {
	_, err := f.db.Exec(`UPDATE transfer_jobs SET status='cancelled', error=?, completed_at=?
		WHERE id=? AND status IN ('failed','completed')`, finalization.errorMessage,
		finalization.completedAt.UTC().Format(time.RFC3339Nano), finalization.taskID)
	if err != nil {
		return fmt.Errorf("promote cancelled transfer finalization: %w", err)
	}
	return nil
}

func (f *FileService) rememberTransferFinalization(finalization transferFinalization) error {
	f.finalizationMu.Lock()
	defer f.finalizationMu.Unlock()
	if f.pendingFinalizations == nil {
		f.pendingFinalizations = make(map[string]transferFinalization)
	}
	current, exists := f.pendingFinalizations[finalization.taskID]
	if !exists || transferFinalizationPriority(current.status) < transferFinalizationPriority(finalization.status) {
		f.pendingFinalizations[finalization.taskID] = finalization
	}
	return f.persistTransferFinalizationJournalLocked()
}

func transferFinalizationPriority(status string) int {
	switch status {
	case "cancelled":
		return transferFinalizationCancelledPriority
	case "completed":
		return transferFinalizationCompletedPriority
	case "failed":
		return transferFinalizationFailedPriority
	default:
		return transferFinalizationUnknownPriority
	}
}

func (f *FileService) clearTransferFinalization(finalization transferFinalization) error {
	f.finalizationMu.Lock()
	defer f.finalizationMu.Unlock()
	current, exists := f.pendingFinalizations[finalization.taskID]
	if !exists || current != finalization {
		return nil
	}
	delete(f.pendingFinalizations, finalization.taskID)
	if err := f.persistTransferFinalizationJournalLocked(); err != nil {
		f.pendingFinalizations[finalization.taskID] = current
		return err
	}
	return nil
}

func (f *FileService) pendingTransferFinalizations() []transferFinalization {
	f.finalizationMu.Lock()
	defer f.finalizationMu.Unlock()
	result := make([]transferFinalization, 0, len(f.pendingFinalizations))
	for _, finalization := range f.pendingFinalizations {
		result = append(result, finalization)
	}
	return result
}

func (f *FileService) reconcilePendingTransferFinalizations() {
	if f == nil || f.db == nil {
		return
	}
	for _, finalization := range f.pendingTransferFinalizations() {
		if err := f.persistTransferFinalization(finalization); err != nil {
			f.logTransferFinalizationError("reconcile transfer finalization failed", finalization, err)
			continue
		}
		if err := f.clearTransferFinalization(finalization); err != nil {
			f.logTransferFinalizationError("clear reconciled transfer finalization failed", finalization, err)
		}
	}
}

func (f *FileService) logTransferFinalizationError(message string, finalization transferFinalization, err error) {
	if err != nil && f.logger != nil {
		f.logger.Error(message, "taskID", finalization.taskID, "status", finalization.status, "error", err)
	}
}

func (f *FileService) overlayPendingTransferFinalizations(jobs []model.TransferJob) []model.TransferJob {
	pending := f.pendingTransferFinalizations()
	byID := make(map[string]transferFinalization, len(pending))
	for _, finalization := range pending {
		byID[finalization.taskID] = finalization
	}
	for index := range jobs {
		finalization, exists := byID[jobs[index].ID]
		if !exists || transferFinalizationPriority(jobs[index].Status) >= transferFinalizationPriority(finalization.status) {
			continue
		}
		applyTransferFinalization(&jobs[index], finalization)
	}
	return jobs
}

func applyTransferFinalization(job *model.TransferJob, finalization transferFinalization) {
	job.Status = finalization.status
	job.Error = finalization.errorMessage
	completedAt := finalization.completedAt
	job.CompletedAt = &completedAt
	if finalization.status != "completed" {
		return
	}
	job.TransferredBytes = finalization.transferred
	job.TotalBytes = finalization.total
	job.Speed = 0
	job.ETA = 0
}
