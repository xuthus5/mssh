package store

import (
	"database/sql"
	"fmt"
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
	_, err := db.Exec(`UPDATE transfer_jobs SET status='running', transferred_bytes=?, total_bytes=?, speed=?, eta=? WHERE id=?`, transferred, total, speed, eta, id)
	if err != nil {
		return fmt.Errorf("update transfer job: %w", err)
	}
	return nil
}

func FinishTransferJob(db *sql.DB, id, status, errorMessage string) error {
	return withBusyRetry(func() error {
		_, err := db.Exec(`UPDATE transfer_jobs SET status=?, error=?, completed_at=? WHERE id=?`, status, errorMessage, time.Now().UTC().Format(time.RFC3339Nano), id)
		if err != nil {
			return fmt.Errorf("finish transfer job: %w", err)
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
