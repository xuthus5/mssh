package service

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestCancelTransferClosesBlockingTransport(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	var closed atomic.Bool
	service.mu.Lock()
	service.tasks["active"] = cancel
	service.taskClosers["active"] = func() error {
		closed.Store(true)
		return nil
	}
	service.mu.Unlock()

	assert.NoError(t, service.CancelTransfer("active"))
	assert.True(t, closed.Load())
	assert.ErrorIs(t, ctx.Err(), context.Canceled)
}

func TestCancelTransferCancelsOutsideTaskRegistryLock(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	var cancelledUnderLock atomic.Bool
	service.mu.Lock()
	service.tasks["active"] = lockAwareCancel(service, cancel, &cancelledUnderLock)
	service.mu.Unlock()

	require.NoError(t, service.CancelTransfer("active"))
	assert.False(t, cancelledUnderLock.Load())
	assert.ErrorIs(t, ctx.Err(), context.Canceled)
}

func TestCancelAllCancelsOutsideTaskRegistryLock(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	var cancelledUnderLock atomic.Bool
	service.mu.Lock()
	service.tasks["active"] = lockAwareCancel(service, cancel, &cancelledUnderLock)
	service.mu.Unlock()

	service.CancelAll()
	assert.False(t, cancelledUnderLock.Load())
	assert.ErrorIs(t, ctx.Err(), context.Canceled)
}

func TestAttachTaskCloserRejectsCancelledTask(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	service.mu.Lock()
	service.tasks["cancelled"] = cancel
	service.mu.Unlock()
	cancel()

	attached := service.attachTaskCloser("cancelled", ctx, func() error { return nil })
	assert.False(t, attached)
	service.mu.Lock()
	_, exists := service.taskClosers["cancelled"]
	service.mu.Unlock()
	assert.False(t, exists)
}

func TestCancelTransferContinuesWhenTransportCloseFails(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	service.mu.Lock()
	service.tasks["close-error"] = cancel
	service.taskClosers["close-error"] = func() error {
		return errors.New("close failed")
	}
	service.mu.Unlock()

	require.NoError(t, service.CancelTransfer("close-error"))
	assert.ErrorIs(t, ctx.Err(), context.Canceled)
}

func TestWaitForTransfersWaitsForWorkers(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	service.workers.Add(1)
	done := make(chan struct{})
	go func() {
		service.WaitForTransfers()
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("wait returned before transfer worker stopped")
	case <-time.After(20 * time.Millisecond):
	}
	service.workers.Done()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("wait did not return after transfer worker stopped")
	}
}

func TestStopAndWaitCancelsWorkersAndRejectsNewTransfers(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	var closed atomic.Bool
	closedSignal := make(chan struct{})
	service.mu.Lock()
	service.tasks["active"] = cancel
	service.taskSessions["active"] = 1
	service.taskClosers["active"] = func() error {
		closed.Store(true)
		close(closedSignal)
		return nil
	}
	service.workers.Add(1)
	service.mu.Unlock()

	stopDone := make(chan struct{})
	go func() {
		service.StopAndWait()
		close(stopDone)
	}()

	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("stop did not cancel active transfer")
	}
	select {
	case <-closedSignal:
	case <-time.After(time.Second):
		t.Fatal("stop did not close active transfer transport")
	}
	assert.True(t, closed.Load())
	select {
	case <-stopDone:
		t.Fatal("stop returned before worker completed")
	case <-time.After(20 * time.Millisecond):
	}

	service.workers.Done()
	select {
	case <-stopDone:
	case <-time.After(time.Second):
		t.Fatal("stop did not wait for worker completion")
	}

	_, newCancel := context.WithCancel(context.Background())
	defer newCancel()
	assert.ErrorContains(t, service.registerTask("new", 2, newCancel), "shutting down")
}

func TestStopAndWaitWaitsForActiveTransferMetadataRead(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(database))
	assertDatabaseServiceShutdownWaits(t, database, func() error {
		_, err := service.ListTransfers()
		return err
	}, service.StopAndWait)
}

func TestFileServiceRejectsOperationsAfterShutdown(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(database))
	service.StopAndWait()

	_, err := service.ListTransfers()
	require.ErrorContains(t, err, "shutting down")
	_, err = service.ListDir(1, ".")
	require.ErrorContains(t, err, "shutting down")
	require.ErrorContains(t, service.Delete(1, "."), "shutting down")
	require.ErrorContains(t, service.Mkdir(1, "new-dir"), "shutting down")
	require.ErrorContains(t, service.Rename(1, "old", "new"), "shutting down")
	_, err = service.Upload(1, "source", "target")
	require.ErrorContains(t, err, "shutting down")
	_, err = service.Download(1, "source", "target")
	require.ErrorContains(t, err, "shutting down")
	require.ErrorContains(t, service.CancelTransfer("task"), "shutting down")
}

func TestPauseAndWaitCancelsWorkersAndAllowsNewTransfers(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	service.mu.Lock()
	service.tasks["active"] = cancel
	service.workers.Add(1)
	service.mu.Unlock()

	pauseDone := make(chan struct{})
	go func() {
		service.PauseAndWait()
		close(pauseDone)
	}()

	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("pause did not cancel active transfer")
	}
	service.workers.Done()
	select {
	case <-pauseDone:
	case <-time.After(time.Second):
		t.Fatal("pause did not wait for worker completion")
	}

	_, newCancel := context.WithCancel(context.Background())
	require.NoError(t, service.registerTask("new", 2, newCancel))
	service.releaseRegisteredTask("new", newCancel)
}

func TestPauseAndWaitReconcilesPendingTransferFinalizations(t *testing.T) {
	database := testutil.NewTestDB(t)
	require.NoError(t, store.CreateTransferJob(database, model.TransferJob{
		ID: "pause-finalization", SessionID: 1, SessionName: "server", Direction: "upload",
		SourcePath: "/tmp/source", TargetPath: "/remote/target", Status: "running", StartedAt: time.Now(),
	}))
	require.NoError(t, createTransferFinalizationTrigger(database))
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(database))
	service.finishTransfer(transferFinalization{
		taskID: "pause-finalization", status: "completed", transferred: 64, total: 64,
	})
	require.NoError(t, dropTransferFinalizationTrigger(database))

	service.PauseAndWait()

	jobs, err := store.ListTransferJobs(database)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "completed", jobs[0].Status)
	assert.Equal(t, int64(64), jobs[0].TransferredBytes)
	finish, err := service.beginOperation()
	require.NoError(t, err)
	finish()
}

func TestFileServiceLifecycleMethodsHandleNilReceiver(t *testing.T) {
	var service *FileService

	service.WaitForTransfers()
	service.PauseAndWait()
	service.StopAndWait()
	service.CancelForSessions([]int64{1})
}

func TestFileServiceCancelForSessionsIgnoresInvalidIDs(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())

	service.CancelForSessions(nil)
	service.CancelForSessions([]int64{0, -1})
}

func TestFileServiceCancelForSessionsLogsPersistenceFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, db.Close())
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(db))

	service.CancelForSessions([]int64{1})
}

func TestFileServiceCancelForSessionsSkipsTasksWithoutOwnership(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	service.mu.Lock()
	service.tasks["unowned"] = cancel
	service.mu.Unlock()

	service.CancelForSessions([]int64{1})
	select {
	case <-ctx.Done():
		t.Fatal("unowned transfer was cancelled")
	default:
	}
}

func TestFileServiceCancelForSessionsEmitsCancelled(t *testing.T) {
	bus := newMockEventBus()
	service := NewFileService(nil, bus, testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	var cancelledUnderLock atomic.Bool
	service.mu.Lock()
	service.tasks["task-cancel-ui"] = lockAwareCancel(service, cancel, &cancelledUnderLock)
	service.taskSessions["task-cancel-ui"] = 7
	service.mu.Unlock()

	service.CancelForSessions([]int64{7})
	assert.ErrorIs(t, ctx.Err(), context.Canceled)
	assert.False(t, cancelledUnderLock.Load())
	assert.True(t, bus.hasEvent(event.TransferComplete))
	assert.True(t, hasCancelledTransferEvent(bus, "task-cancel-ui"))
}

func lockAwareCancel(service *FileService, cancel context.CancelFunc, cancelledUnderLock *atomic.Bool) context.CancelFunc {
	return func() {
		if service.mu.TryLock() {
			service.mu.Unlock()
		} else {
			cancelledUnderLock.Store(true)
		}
		cancel()
	}
}

func hasCancelledTransferEvent(bus *mockEventBus, taskID string) bool {
	for _, item := range bus.Events() {
		payload, ok := item.Payload.(event.TransferProgressPayload)
		if item.Name == event.TransferComplete && ok && payload.TaskID == taskID && payload.Status == "cancelled" {
			return true
		}
	}
	return false
}
