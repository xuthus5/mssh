package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func CreateTransferJob(db *sql.DB, job model.TransferJob) error {
	_, err := db.Exec(`INSERT INTO transfer_jobs (id, session_id, session_name, direction, source_path, target_path, total_bytes, transferred_bytes, speed, eta, status, error, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, job.ID, job.SessionID, job.SessionName, job.Direction, job.SourcePath, job.TargetPath, job.TotalBytes, job.TransferredBytes, job.Speed, job.ETA, job.Status, job.Error, job.StartedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("create transfer job: %w", err)
	}
	return nil
}

func UpdateTransferProgress(db *sql.DB, id string, transferred, total, speed, eta int64) error {
	return withBusyRetry(func() error {
		return updateTransferProgressOnce(db, id, transferred, total, speed, eta)
	})
}

func updateTransferProgressOnce(db *sql.DB, id string, transferred, total, speed, eta int64) error {
	_, err := db.Exec(`UPDATE transfer_jobs SET status='running', transferred_bytes=?, total_bytes=?, speed=?, eta=? WHERE id=? AND status IN ('queued','running')`, transferred, total, speed, eta, id)
	if err != nil {
		return fmt.Errorf("update transfer job: %w", err)
	}
	return nil
}

func FinishTransferJob(db *sql.DB, id, status, errorMessage string) error {
	return withBusyRetry(func() error {
		completedAt := time.Now().UTC().Format(time.RFC3339Nano)
		if status == "cancelled" {
			return finishCancelledTransferJob(db, id, errorMessage, completedAt)
		}
		// Do not regress an already terminal cancelled/completed row (e.g. session delete race).
		_, err := db.Exec(`UPDATE transfer_jobs SET status=?, error=?, completed_at=? WHERE id=? AND status IN ('queued','running')`, status, errorMessage, completedAt, id)
		if err != nil {
			return fmt.Errorf("finish transfer job: %w", err)
		}
		return nil
	})
}

func finishCancelledTransferJob(db *sql.DB, id, errorMessage, completedAt string) error {
	_, err := db.Exec(`UPDATE transfer_jobs SET status='cancelled', error=CASE
		WHEN ?='' THEN error
		WHEN error='' THEN ?
		WHEN instr(error, ?)>0 THEN error
		ELSE error || char(10) || ? END, completed_at=?
		WHERE id=? AND status IN ('queued','running','cancelled')`,
		errorMessage, errorMessage, errorMessage, errorMessage, completedAt, id)
	if err != nil {
		return fmt.Errorf("finish cancelled transfer job: %w", err)
	}
	return nil
}

func FinishTransferJobWithProgress(db *sql.DB, job model.TransferJob) error {
	return withBusyRetry(func() error {
		completedAt := time.Now().UTC()
		if job.CompletedAt != nil {
			completedAt = job.CompletedAt.UTC()
		}
		_, err := db.Exec(`UPDATE transfer_jobs SET status=?, error=?, transferred_bytes=?, total_bytes=?, speed=0, eta=0, completed_at=? WHERE id=? AND status IN ('queued','running')`, job.Status, job.Error, job.TransferredBytes, job.TotalBytes, completedAt.Format(time.RFC3339Nano), job.ID)
		if err != nil {
			return fmt.Errorf("finish transfer job with progress: %w", err)
		}
		return nil
	})
}

func MarkInterruptedTransfers(db *sql.DB) error {
	_, err := db.Exec(`UPDATE transfer_jobs SET status='failed', error='应用退出导致传输中断', completed_at=? WHERE status IN ('queued','running')`, time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func ListTransferJobs(db *sql.DB) ([]model.TransferJob, error) {
	rows, err := db.Query(`SELECT id, session_id, session_name, direction, source_path, target_path, total_bytes, transferred_bytes, speed, eta, status, error, started_at, completed_at FROM transfer_jobs ORDER BY started_at DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("list transfer jobs: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]model.TransferJob, 0)
	for rows.Next() {
		var job model.TransferJob
		var started string
		var completed sql.NullString
		if err := rows.Scan(&job.ID, &job.SessionID, &job.SessionName, &job.Direction, &job.SourcePath, &job.TargetPath, &job.TotalBytes, &job.TransferredBytes, &job.Speed, &job.ETA, &job.Status, &job.Error, &started, &completed); err != nil {
			return nil, err
		}
		job.StartedAt, _ = time.Parse(time.RFC3339Nano, started)
		if completed.Valid {
			value, _ := time.Parse(time.RFC3339Nano, completed.String)
			job.CompletedAt = &value
		}
		result = append(result, job)
	}
	return result, rows.Err()
}

func CancelTransferJobsForSessions(db *sql.DB, sessionIDs []int64) error {
	if db == nil || len(sessionIDs) == 0 {
		return nil
	}
	return withBusyRetry(func() error {
		placeholders := make([]string, 0, len(sessionIDs))
		args := make([]any, 0, len(sessionIDs)+1)
		args = append(args, time.Now().UTC().Format(time.RFC3339Nano))
		for _, id := range sessionIDs {
			if id <= 0 {
				continue
			}
			placeholders = append(placeholders, "?")
			args = append(args, id)
		}
		if len(placeholders) == 0 {
			return nil
		}
		query := "UPDATE transfer_jobs SET status='cancelled', error='会话已删除', completed_at=? WHERE status IN ('queued','running') AND session_id IN (" + strings.Join(placeholders, ",") + ")"
		if _, err := db.Exec(query, args...); err != nil {
			return fmt.Errorf("cancel transfer jobs for sessions: %w", err)
		}
		return nil
	})
}
