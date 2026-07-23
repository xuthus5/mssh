package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

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

func TestTransferAborted(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	assert.True(t, transferAborted(ctx, errors.New("connection reset")))
	assert.True(t, transferAborted(context.Background(), context.Canceled))
	assert.False(t, transferAborted(context.Background(), errors.New("disk full")))
}

func TestFileService_CancelForSessionsEmitsCancelled(t *testing.T) {
	bus := newMockEventBus()
	svc := NewFileService(nil, bus, testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	svc.mu.Lock()
	svc.tasks["task-cancel-ui"] = cancel
	svc.taskSessions["task-cancel-ui"] = 7
	svc.mu.Unlock()

	svc.CancelForSessions([]int64{7})
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("context not cancelled")
	}
	assert.True(t, bus.hasEvent(event.TransferComplete))
	found := false
	for _, item := range bus.Events() {
		if item.Name != event.TransferComplete {
			continue
		}
		payload, ok := item.Payload.(event.TransferProgressPayload)
		if ok && payload.TaskID == "task-cancel-ui" && payload.Status == "cancelled" {
			found = true
		}
	}
	assert.True(t, found)
}
