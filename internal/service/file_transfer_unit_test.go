package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/ssh"
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
