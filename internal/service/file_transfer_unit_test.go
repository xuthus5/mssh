package service

import (
	"errors"
	"testing"

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
