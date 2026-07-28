package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

type transferStatusEventBus struct {
	db           *sql.DB
	statusAtEmit string
	err          error
}

func (bus *transferStatusEventBus) Emit(name string, _ interface{}) {
	if name != event.TransferComplete {
		return
	}
	bus.err = bus.db.QueryRow("SELECT status FROM transfer_jobs WHERE id = ?", "ordered-complete").Scan(&bus.statusAtEmit)
}

type transferServiceStatusEventBus struct {
	service   *FileService
	eventName string
	taskID    string
	job       model.TransferJob
	err       error
}

type transferTerminalOverlayCase struct {
	name         string
	eventName    string
	status       string
	errorMessage string
	emit         func(*FileService, string)
}

func (bus *transferServiceStatusEventBus) Emit(name string, _ interface{}) {
	if name != bus.eventName {
		return
	}
	jobs, err := bus.service.ListTransfers()
	if err != nil {
		bus.err = err
		return
	}
	for _, job := range jobs {
		if job.ID == bus.taskID {
			bus.job = job
			return
		}
	}
	bus.err = errors.New("transfer missing at event")
}

func TestFileServiceUploadDownloadValidation(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(db))

	_, err := svc.Upload(1, "", "/remote")
	assert.Error(t, err)
	_, err = svc.Upload(1, "/tmp/x", "")
	assert.Error(t, err)
	_, err = svc.Download(1, "", "/tmp/x")
	assert.Error(t, err)
	_, err = svc.Download(1, "/remote", "")
	assert.Error(t, err)
}

func TestFileServiceEmitHelpersAndCancelMissing(t *testing.T) {
	bus := newMockEventBus()
	svc := NewFileService(nil, bus, testutil.NewTestLogger())
	svc.emitTransferError("task-1", errors.New("boom"))
	svc.emitTransferCancelled("task-2")
	assert.True(t, bus.hasEvent(event.TransferError))
	assert.True(t, bus.hasEvent(event.TransferComplete))
	assert.Error(t, svc.CancelTransfer("missing"))
	svc.CancelAll()
}

func TestEmitTransferCompletedPersistsBeforeEvent(t *testing.T) {
	database := testutil.NewTestDB(t)
	require.NoError(t, store.CreateTransferJob(database, model.TransferJob{
		ID: "ordered-complete", SessionID: 1, SessionName: "server", Direction: "upload",
		SourcePath: "/tmp/source", TargetPath: "/remote/target", Status: "queued", StartedAt: time.Now(),
	}))
	bus := &transferStatusEventBus{db: database}
	service := NewFileService(nil, bus, testutil.NewTestLogger(), WithTransferDB(database))

	service.emitTransferCompleted("ordered-complete", 10, 10)

	require.NoError(t, bus.err)
	assert.Equal(t, "completed", bus.statusAtEmit)
}

func TestEmitTransferCompletedOverlaysPersistenceFailureAndReconciles(t *testing.T) {
	database := testutil.NewTestDB(t)
	require.NoError(t, store.CreateTransferJob(database, model.TransferJob{
		ID: "pending-complete", SessionID: 1, SessionName: "server", Direction: "upload",
		SourcePath: "/tmp/source", TargetPath: "/remote/target", Status: "queued", StartedAt: time.Now(),
	}))
	require.NoError(t, createTransferFinalizationTrigger(database))
	bus := &transferServiceStatusEventBus{eventName: event.TransferComplete, taskID: "pending-complete"}
	service := NewFileService(nil, bus, testutil.NewTestLogger(), WithTransferDB(database))
	bus.service = service

	service.emitTransferCompleted("pending-complete", 10, 10)

	require.NoError(t, bus.err)
	assert.Equal(t, "completed", bus.job.Status)
	assert.Equal(t, int64(10), bus.job.TransferredBytes)
	var databaseStatus string
	require.NoError(t, database.QueryRow("SELECT status FROM transfer_jobs WHERE id = ?", bus.taskID).Scan(&databaseStatus))
	assert.Equal(t, "queued", databaseStatus)
	require.NoError(t, dropTransferFinalizationTrigger(database))
	jobs, err := service.ListTransfers()
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "completed", jobs[0].Status)
	assert.Equal(t, int64(10), jobs[0].TransferredBytes)
	assert.Equal(t, int64(10), jobs[0].TotalBytes)
}

func TestTransferTerminalEventsOverlayFailedAndCancelledPersistence(t *testing.T) {
	tests := []transferTerminalOverlayCase{
		{name: "failed", eventName: event.TransferError, status: "failed", errorMessage: "disk full",
			emit: func(service *FileService, taskID string) { service.emitTransferError(taskID, errors.New("disk full")) }},
		{name: "cancelled", eventName: event.TransferComplete, status: "cancelled",
			emit: func(service *FileService, taskID string) { service.emitTransferCancelled(taskID) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertTransferTerminalOverlay(t, test)
		})
	}
}

func assertTransferTerminalOverlay(t *testing.T, test transferTerminalOverlayCase) {
	t.Helper()
	database := testutil.NewTestDB(t)
	require.NoError(t, store.CreateTransferJob(database, model.TransferJob{
		ID: "pending-" + test.status, SessionID: 1, SessionName: "server", Direction: "download",
		SourcePath: "/remote/source", TargetPath: "/tmp/target", Status: "running", StartedAt: time.Now(),
	}))
	require.NoError(t, createTransferFinalizationTrigger(database))
	bus := &transferServiceStatusEventBus{eventName: test.eventName, taskID: "pending-" + test.status}
	service := NewFileService(nil, bus, testutil.NewTestLogger(), WithTransferDB(database))
	bus.service = service

	test.emit(service, bus.taskID)

	require.NoError(t, bus.err)
	assert.Equal(t, test.status, bus.job.Status)
	assert.Equal(t, test.errorMessage, bus.job.Error)
	assert.NotNil(t, bus.job.CompletedAt)
	require.NoError(t, dropTransferFinalizationTrigger(database))
	jobs, err := service.ListTransfers()
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, test.status, jobs[0].Status)
	assert.Equal(t, test.errorMessage, jobs[0].Error)
}

func TestPendingTransferFinalizationPrefersCancellation(t *testing.T) {
	database := testutil.NewTestDB(t)
	require.NoError(t, store.CreateTransferJob(database, model.TransferJob{
		ID: "pending-priority", SessionID: 1, SessionName: "server", Direction: "upload",
		SourcePath: "/tmp/source", TargetPath: "/remote/target", Status: "running", StartedAt: time.Now(),
	}))
	require.NoError(t, createTransferFinalizationTrigger(database))
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(database))

	service.finishTransfer(transferFinalization{taskID: "pending-priority", status: "cancelled"})
	service.finishTransfer(transferFinalization{taskID: "pending-priority", status: "completed", transferred: 10, total: 10})
	jobs, err := service.ListTransfers()

	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "cancelled", jobs[0].Status)
}

func TestPendingTransferFinalizationsAreConcurrentSafe(t *testing.T) {
	const transferCount = 12
	database := testutil.NewTestDB(t)
	for index := range transferCount {
		taskID := fmt.Sprintf("pending-concurrent-%d", index)
		require.NoError(t, store.CreateTransferJob(database, model.TransferJob{
			ID: taskID, SessionID: 1, SessionName: "server", Direction: "upload",
			SourcePath: "/tmp/source", TargetPath: "/remote/target", Status: "running", StartedAt: time.Now(),
		}))
	}
	require.NoError(t, createTransferFinalizationTrigger(database))
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(database))
	errorsFound := make(chan error, transferCount)
	var workers sync.WaitGroup
	for index := range transferCount {
		taskID := fmt.Sprintf("pending-concurrent-%d", index)
		workers.Go(func() {
			service.finishTransfer(transferFinalization{
				taskID: taskID, status: "completed", transferred: 10, total: 10,
			})
		})
		workers.Go(func() {
			_, err := service.ListTransfers()
			if err != nil {
				errorsFound <- err
			}
		})
	}
	workers.Wait()
	close(errorsFound)
	for err := range errorsFound {
		require.NoError(t, err)
	}
	jobs, err := service.ListTransfers()
	require.NoError(t, err)
	require.Len(t, jobs, transferCount)
	for _, job := range jobs {
		assert.Equal(t, "completed", job.Status)
	}
}

func createTransferFinalizationTrigger(database *sql.DB) error {
	_, err := database.Exec(`CREATE TRIGGER block_transfer_finalization BEFORE UPDATE OF status ON transfer_jobs
		WHEN NEW.status IN ('completed','failed','cancelled')
		BEGIN SELECT RAISE(ABORT, 'terminal persistence blocked'); END`)
	return err
}

func dropTransferFinalizationTrigger(database *sql.DB) error {
	_, err := database.Exec("DROP TRIGGER block_transfer_finalization")
	return err
}

func TestFileServiceRunUploadEmitsErrorForMissingSource(t *testing.T) {
	sftpContext := startSFTPTestServer(t)
	t.Cleanup(sftpContext.cancel)
	service, session := createSFTPFileService(t, sftpContext)
	client, cleanup := openTestSFTPClient(t, service, session.ID)
	t.Cleanup(cleanup)

	service.runUpload(transferExecution{
		ctx: context.Background(), taskID: "upload-error", client: client,
		source: filepath.Join(t.TempDir(), "missing"), target: "/remote",
	})

	assert.True(t, transferErrorEventHasTask(service.eventBus.(*mockEventBus), "upload-error"))
}

func TestFileServiceRunDownloadEmitsErrorForMissingRemote(t *testing.T) {
	sftpContext := startSFTPTestServer(t)
	t.Cleanup(sftpContext.cancel)
	service, session := createSFTPFileService(t, sftpContext)
	client, cleanup := openTestSFTPClient(t, service, session.ID)
	t.Cleanup(cleanup)
	localPath := filepath.Join(t.TempDir(), "download")

	service.runDownload(transferExecution{
		ctx: context.Background(), taskID: "download-error", client: client,
		source: "/missing", target: localPath,
	})

	assert.True(t, transferErrorEventHasTask(service.eventBus.(*mockEventBus), "download-error"))
	_, err := os.Stat(downloadPartialPath(localPath, "download-error"))
	assert.ErrorIs(t, err, os.ErrNotExist)
}

func openTestSFTPClient(t *testing.T, service *FileService, sessionID int64) (*ssh.SFTPClient, func()) {
	t.Helper()
	wrapper, connectionID, err := service.connect(context.Background(), sessionID)
	require.NoError(t, err)
	client, err := ssh.OpenSFTP(wrapper)
	if err != nil {
		service.disconnect(connectionID)
		require.NoError(t, err)
	}
	return client, func() {
		_ = client.Close()
		service.disconnect(connectionID)
	}
}

func transferErrorEventHasTask(bus *mockEventBus, taskID string) bool {
	for _, captured := range bus.Events() {
		if captured.Name != event.TransferError {
			continue
		}
		payload, ok := captured.Payload.(event.TransferErrorPayload)
		if ok && payload.TaskID == taskID {
			return payload.Error != ""
		}
	}
	return false
}

func TestTransferAborted(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	assert.True(t, transferAborted(ctx, errors.New("connection reset")))
	assert.True(t, transferAborted(context.Background(), context.Canceled))
	assert.False(t, transferAborted(context.Background(), errors.New("disk full")))
}

func TestDownloadPartialPathIsUniquePerTask(t *testing.T) {
	localPath := filepath.Join(t.TempDir(), "result.txt")
	first := downloadPartialPath(localPath, "file-one")
	second := downloadPartialPath(localPath, "file-two")

	assert.NotEqual(t, first, second)
	assert.Equal(t, localPath, filepath.Dir(first)+string(filepath.Separator)+"result.txt")
	assert.Contains(t, filepath.Base(first), "file-one")
	assert.Contains(t, filepath.Base(second), "file-two")
}
