package store

import (
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func transferTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, InitializeSchema(db))
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func TestTransferJobLifecycle(t *testing.T) {
	db := transferTestDB(t)
	job := model.TransferJob{ID: "task-1", SessionID: 7, SessionName: "server", Direction: "upload", SourcePath: "/tmp/a", TargetPath: "/a", Status: "queued", StartedAt: time.Now()}
	require.NoError(t, CreateTransferJob(db, job))
	require.NoError(t, UpdateTransferProgress(db, job.ID, 50, 100, 25, 2))
	require.NoError(t, FinishTransferJob(db, job.ID, "completed", ""))
	jobs, err := ListTransferJobs(db)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	require.Equal(t, int64(50), jobs[0].TransferredBytes)
	require.Equal(t, "completed", jobs[0].Status)
	require.NotNil(t, jobs[0].CompletedAt)
}

func TestFinishTransferJobWithProgress(t *testing.T) {
	db := transferTestDB(t)
	startedAt := time.Now().Add(-time.Minute)
	completedAt := time.Now().UTC().Truncate(time.Nanosecond)
	require.NoError(t, CreateTransferJob(db, model.TransferJob{
		ID: "task-with-progress", SessionID: 7, SessionName: "server", Direction: "download",
		SourcePath: "/remote/a", TargetPath: "/tmp/a", Status: "running", StartedAt: startedAt,
	}))
	require.NoError(t, FinishTransferJobWithProgress(db, model.TransferJob{
		ID: "task-with-progress", Status: "completed", TransferredBytes: 128, TotalBytes: 128,
		CompletedAt: &completedAt,
	}))

	jobs, err := ListTransferJobs(db)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "completed", jobs[0].Status)
	assert.Equal(t, int64(128), jobs[0].TransferredBytes)
	assert.Equal(t, int64(128), jobs[0].TotalBytes)
	require.NotNil(t, jobs[0].CompletedAt)
	assert.True(t, jobs[0].CompletedAt.Equal(completedAt))
}

func TestMarkInterruptedTransfers(t *testing.T) {
	db := transferTestDB(t)
	require.NoError(t, CreateTransferJob(db, model.TransferJob{ID: "running", SessionID: 1, SessionName: "s", Direction: "download", SourcePath: "/a", TargetPath: "/b", Status: "running", StartedAt: time.Now()}))
	require.NoError(t, MarkInterruptedTransfers(db))
	jobs, err := ListTransferJobs(db)
	require.NoError(t, err)
	require.Equal(t, "failed", jobs[0].Status)
	require.Contains(t, jobs[0].Error, "中断")
}

func TestCancelTransferJobsForSessions(t *testing.T) {
	db := transferTestDB(t)
	require.NoError(t, CreateTransferJob(db, model.TransferJob{
		ID: "keep", SessionID: 1, SessionName: "a", Direction: "upload",
		SourcePath: "/k", TargetPath: "/rk", Status: "running", StartedAt: time.Now(),
	}))
	require.NoError(t, CreateTransferJob(db, model.TransferJob{
		ID: "drop", SessionID: 2, SessionName: "b", Direction: "download",
		SourcePath: "/d", TargetPath: "/rd", Status: "queued", StartedAt: time.Now(),
	}))
	require.NoError(t, CreateTransferJob(db, model.TransferJob{
		ID: "done", SessionID: 2, SessionName: "b", Direction: "upload",
		SourcePath: "/x", TargetPath: "/rx", Status: "completed", StartedAt: time.Now(),
	}))
	require.NoError(t, CancelTransferJobsForSessions(db, []int64{2}))
	jobs, err := ListTransferJobs(db)
	require.NoError(t, err)
	byID := map[string]model.TransferJob{}
	for _, job := range jobs {
		byID[job.ID] = job
	}
	require.Equal(t, "running", byID["keep"].Status)
	require.Equal(t, "cancelled", byID["drop"].Status)
	require.Equal(t, "会话已删除", byID["drop"].Error)
	require.Equal(t, "completed", byID["done"].Status)
}

func TestFinishTransferJobDoesNotRegressCancelled(t *testing.T) {
	db := transferTestDB(t)
	require.NoError(t, CreateTransferJob(db, model.TransferJob{
		ID: "race", SessionID: 3, SessionName: "s", Direction: "upload",
		SourcePath: "/a", TargetPath: "/b", Status: "running", StartedAt: time.Now(),
	}))
	require.NoError(t, CancelTransferJobsForSessions(db, []int64{3}))
	require.NoError(t, FinishTransferJob(db, "race", "failed", "connection closed"))
	jobs, err := ListTransferJobs(db)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	require.Equal(t, "cancelled", jobs[0].Status)
	require.Equal(t, "会话已删除", jobs[0].Error)
}

func TestFinishTransferJobAppendsCleanupErrorToCancelledReason(t *testing.T) {
	db := transferTestDB(t)
	require.NoError(t, CreateTransferJob(db, model.TransferJob{
		ID: "cancel-cleanup", SessionID: 3, SessionName: "s", Direction: "upload",
		SourcePath: "/a", TargetPath: "/b", Status: "running", StartedAt: time.Now(),
	}))
	require.NoError(t, CancelTransferJobsForSessions(db, []int64{3}))
	cleanupErr := "cleanup remote partial: permission denied"
	require.NoError(t, FinishTransferJob(db, "cancel-cleanup", "cancelled", cleanupErr))
	require.NoError(t, FinishTransferJob(db, "cancel-cleanup", "cancelled", cleanupErr))

	jobs, err := ListTransferJobs(db)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "cancelled", jobs[0].Status)
	assert.Contains(t, jobs[0].Error, "会话已删除")
	assert.Equal(t, 1, strings.Count(jobs[0].Error, cleanupErr))
}

func TestUpdateTransferProgressDoesNotRegressCancelled(t *testing.T) {
	db := transferTestDB(t)
	require.NoError(t, CreateTransferJob(db, model.TransferJob{
		ID: "progress-race", SessionID: 4, SessionName: "s", Direction: "download",
		SourcePath: "/a", TargetPath: "/b", Status: "running", StartedAt: time.Now(),
	}))
	require.NoError(t, CancelTransferJobsForSessions(db, []int64{4}))
	require.NoError(t, UpdateTransferProgress(db, "progress-race", 10, 100, 5, 18))

	jobs, err := ListTransferJobs(db)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	require.Equal(t, "cancelled", jobs[0].Status)
	require.Equal(t, int64(0), jobs[0].TransferredBytes)
}
