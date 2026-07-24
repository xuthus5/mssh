package service

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
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

func TestCancelTransferCancelsWhileTaskRegistryIsLocked(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	var cancelledUnderLock atomic.Bool
	service.mu.Lock()
	service.tasks["active"] = lockAwareCancel(service, cancel, &cancelledUnderLock)
	service.mu.Unlock()

	require.NoError(t, service.CancelTransfer("active"))
	assert.True(t, cancelledUnderLock.Load())
	assert.ErrorIs(t, ctx.Err(), context.Canceled)
}

func TestCancelAllCancelsWhileTaskRegistryIsLocked(t *testing.T) {
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	var cancelledUnderLock atomic.Bool
	service.mu.Lock()
	service.tasks["active"] = lockAwareCancel(service, cancel, &cancelledUnderLock)
	service.mu.Unlock()

	service.CancelAll()
	assert.True(t, cancelledUnderLock.Load())
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
	service.mu.Lock()
	service.tasks["active"] = cancel
	service.taskSessions["active"] = 1
	service.taskClosers["active"] = func() error {
		closed.Store(true)
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

func TestFileServiceLifecycleMethodsHandleNilReceiver(t *testing.T) {
	var service *FileService

	service.WaitForTransfers()
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
	assert.True(t, cancelledUnderLock.Load())
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
