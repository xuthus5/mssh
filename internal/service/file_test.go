package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
	"mssh/internal/service/testutil"
	sshtestutil "mssh/internal/ssh/testutil"
	"mssh/pkg/event"
)

func TestNewFileService(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	bus := newMockEventBus()
	svc := NewFileService(sessionSvc, bus)

	assert.NotNil(t, svc)
	assert.NotNil(t, svc.tasks)
	assert.Equal(t, 0, len(svc.tasks))
}

func TestFileService_ListDir(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-file", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus())

	_, err = svc.ListDir(created.ID, "/")
	assert.Error(t, err)
}

func TestFileService_ListDirSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	svc := NewFileService(sessionSvc, newMockEventBus())

	_, err := svc.ListDir(999, "/")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "list dir")
}

func TestFileService_Delete(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-file", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus())

	err = svc.Delete(created.ID, "/tmp/nonexistent-file-that-should-fail")
	assert.Error(t, err)
}

func TestFileService_Mkdir(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-file", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus())

	err = svc.Mkdir(created.ID, "/tmp/newdir")
	assert.Error(t, err)
}

func TestFileService_Rename(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-file", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus())

	err = svc.Rename(created.ID, "/tmp/old", "/tmp/new")
	assert.Error(t, err)
}

func TestFileService_Upload(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-upload", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	tmpFile := filepath.Join(t.TempDir(), "upload.dat")
	require.NoError(t, os.WriteFile(tmpFile, []byte("hello upload"), 0o600))

	b := newMockEventBus()
	svc := NewFileService(sessionSvc, b)

	taskID, err := svc.Upload(created.ID, tmpFile, "/tmp/uploaded.dat")
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
	assert.Contains(t, taskID, "term-")
}

func TestFileService_UploadSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	svc := NewFileService(sessionSvc, newMockEventBus())

	tmpFile := filepath.Join(t.TempDir(), "upload.dat")
	require.NoError(t, os.WriteFile(tmpFile, []byte("data"), 0o600))

	_, err := svc.Upload(999, tmpFile, "/tmp/uploaded.dat")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "upload")
}

func TestFileService_Download(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-dl", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	b := newMockEventBus()
	svc := NewFileService(sessionSvc, b)

	localPath := filepath.Join(t.TempDir(), "downloaded.dat")
	taskID, err := svc.Download(created.ID, "/tmp/source.dat", localPath)
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
}

func TestFileService_DownloadSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	svc := NewFileService(sessionSvc, newMockEventBus())

	localPath := filepath.Join(t.TempDir(), "downloaded.dat")
	_, err := svc.Download(999, "/tmp/source.dat", localPath)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "download")
}

func TestFileService_CancelTransfer(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30)

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-cancel", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	tmpFile := filepath.Join(t.TempDir(), "upload.dat")
	require.NoError(t, os.WriteFile(tmpFile, []byte("hello"), 0o600))

	b := newMockEventBus()
	svc := NewFileService(sessionSvc, b)

	taskID, err := svc.Upload(created.ID, tmpFile, "/tmp/uploaded.dat")
	require.NoError(t, err)

	err = svc.CancelTransfer(taskID)
	require.NoError(t, err)
}

func TestFileService_CancelTransferNotFound(t *testing.T) {
	svc := NewFileService(nil, newMockEventBus())
	err := svc.CancelTransfer("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestFileService_DeleteSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	svc := NewFileService(sessionSvc, newMockEventBus())

	err := svc.Delete(999, "/tmp/file")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "delete")
}

func TestFileService_MkdirSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	svc := NewFileService(sessionSvc, newMockEventBus())

	err := svc.Mkdir(999, "/tmp/dir")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "mkdir")
}

func TestFileService_RenameSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	svc := NewFileService(sessionSvc, newMockEventBus())

	err := svc.Rename(999, "/tmp/old", "/tmp/new")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "rename")
}

func TestFileService_reportProgress(t *testing.T) {
	b := newMockEventBus()
	svc := &FileService{
		eventBus: b,
		tasks:    make(map[string]context.CancelFunc),
	}

	svc.reportProgress("task-1", 50, 100)
	lastEvent := b.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TransferProgress, lastEvent.Name)
}
