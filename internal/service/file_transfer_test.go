package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestFileService_Upload(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-upload", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	tmpFile := filepath.Join(t.TempDir(), "upload.dat")
	require.NoError(t, os.WriteFile(tmpFile, []byte("hello upload"), 0o600))

	b := newMockEventBus()
	svc := NewFileService(sessionSvc, b, testutil.NewTestLogger())

	taskID, err := svc.Upload(created.ID, tmpFile, "/tmp/uploaded.dat")
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
	assert.Contains(t, taskID, "file-")
}

func TestFileService_UploadSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	tmpFile := filepath.Join(t.TempDir(), "upload.dat")
	require.NoError(t, os.WriteFile(tmpFile, []byte("data"), 0o600))

	_, err := svc.Upload(999, tmpFile, "/tmp/uploaded.dat")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "upload")
}

func TestFileService_Download(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-dl", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	b := newMockEventBus()
	svc := NewFileService(sessionSvc, b, testutil.NewTestLogger())

	localPath := filepath.Join(t.TempDir(), "downloaded.dat")
	taskID, err := svc.Download(created.ID, "/tmp/source.dat", localPath)
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
}

func TestFileService_DownloadSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	localPath := filepath.Join(t.TempDir(), "downloaded.dat")
	_, err := svc.Download(999, "/tmp/source.dat", localPath)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "download")
}

func TestFileService_CancelTransfer(t *testing.T) {
	svc := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	svc.tasks["active"] = cancel

	require.NoError(t, svc.CancelTransfer("active"))
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("transfer context was not cancelled")
	}
}

func TestFileService_CancelTransferNotFound(t *testing.T) {
	svc := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	err := svc.CancelTransfer("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestFileService_DeleteSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err := svc.Delete(999, "/tmp/file")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "delete")
}

func TestFileService_MkdirSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err := svc.Mkdir(999, "/tmp/dir")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "mkdir")
}

func TestFileService_RenameSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err := svc.Rename(999, "/tmp/old", "/tmp/new")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "rename")
}

func TestFileService_reportProgress(t *testing.T) {
	b := newMockEventBus()
	svc := &FileService{logger: testutil.NewTestLogger(),
		eventBus: b,
		tasks:    make(map[string]context.CancelFunc),
	}

	svc.reportProgress("task-1", 50, 100)
	lastEvent := b.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TransferProgress, lastEvent.Name)
}

func TestFileService_reportProgressNoTotal(t *testing.T) {
	b := newMockEventBus()
	svc := &FileService{logger: testutil.NewTestLogger(),
		eventBus: b,
		tasks:    make(map[string]context.CancelFunc),
	}

	svc.reportProgress("task-1", 50, 0)
	lastEvent := b.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TransferProgress, lastEvent.Name)
}

func TestFileService_getFileSize(t *testing.T) {
	svc := &FileService{logger: testutil.NewTestLogger()}
	size := svc.getFileSize("/nonexistent/file/path/that/does/not/exist")
	assert.Equal(t, int64(0), size)

	tmpFile := filepath.Join(t.TempDir(), "size-test.bin")
	require.NoError(t, os.WriteFile(tmpFile, []byte("hello"), 0o600))
	size = svc.getFileSize(tmpFile)
	assert.Equal(t, int64(5), size)
}

func TestFileService_ConnectError(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	_, err := svc.ListDir(999, "/")
	assert.Error(t, err)

	err = svc.Delete(999, "/file")
	assert.Error(t, err)

	err = svc.Mkdir(999, "/dir")
	assert.Error(t, err)

	err = svc.Rename(999, "/old", "/new")
	assert.Error(t, err)
}

func TestFileService_UploadTaskIDPrefix(t *testing.T) {
	sftpCtx := startSFTPTestServer(t)
	defer sftpCtx.cancel()
	svc, sess := createSFTPFileService(t, sftpCtx)

	tmpFile := filepath.Join(t.TempDir(), "prefix.dat")
	require.NoError(t, os.WriteFile(tmpFile, []byte("x"), 0o600))

	taskID, err := svc.Upload(sess.ID, tmpFile, "/tmp/prefix.dat")
	require.NoError(t, err)
	assert.Contains(t, taskID, "file-")
}

func TestFileService_DownloadTaskIDPrefix(t *testing.T) {
	sftpCtx := startSFTPTestServer(t)
	defer sftpCtx.cancel()
	svc, sess := createSFTPFileService(t, sftpCtx)

	localPath := filepath.Join(t.TempDir(), "dl.dat")
	taskID, err := svc.Download(sess.ID, "/tmp/source.dat", localPath)
	require.NoError(t, err)
	assert.Contains(t, taskID, "file-")
}

func TestFileService_ReportProgressWithSpeedAndETA(t *testing.T) {
	b := newMockEventBus()
	svc := &FileService{
		logger:   testutil.NewTestLogger(),
		eventBus: b,
		tasks:    make(map[string]context.CancelFunc),
		startsAt: make(map[string]time.Time),
	}

	svc.recordStart("task-speed")
	svc.reportProgress("task-speed", 500, 1000)

	lastEvent := b.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TransferProgress, lastEvent.Name)
	payload, ok := lastEvent.Payload.(event.TransferProgressPayload)
	require.True(t, ok)
	assert.Equal(t, 50.0, payload.Percent)
}

func TestFileService_EmitTransferError(t *testing.T) {
	b := newMockEventBus()
	svc := &FileService{
		logger:   testutil.NewTestLogger(),
		eventBus: b,
		tasks:    make(map[string]context.CancelFunc),
		startsAt: make(map[string]time.Time),
	}

	svc.emitTransferError("task-err", fmt.Errorf("disk full"))

	lastEvent := b.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TransferError, lastEvent.Name)
	payload, ok := lastEvent.Payload.(event.TransferErrorPayload)
	require.True(t, ok)
	assert.Equal(t, "task-err", payload.TaskID)
	assert.Contains(t, payload.Error, "disk full")
}

func TestFileService_EmitTransferCancelled(t *testing.T) {
	b := newMockEventBus()
	svc := &FileService{eventBus: b}
	svc.emitTransferCancelled("task-cancelled")
	lastEvent := b.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TransferComplete, lastEvent.Name)
	payload, ok := lastEvent.Payload.(event.TransferProgressPayload)
	require.True(t, ok)
	assert.Equal(t, "cancelled", payload.Status)
}
