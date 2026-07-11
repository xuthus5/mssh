package service

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

type mockSFTPContext struct {
	t      *testing.T
	addr   string
	cancel func()
}

func startSFTPTestServer(t *testing.T) *mockSFTPContext { //nolint:gocognit,cyclop,funlen
	t.Helper()
	handler := sftp.InMemHandler()
	config := &gossh.ServerConfig{NoClientAuth: true}
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromSigner(privateKey)
	require.NoError(t, err)
	config.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	go func() {
		for {
			conn, aErr := listener.Accept()
			if aErr != nil {
				return
			}
			go func(conn net.Conn) {
				sconn, chans, reqs, sErr := gossh.NewServerConn(conn, config)
				if sErr != nil {
					return
				}
				go gossh.DiscardRequests(reqs)
				for ch := range chans {
					if ch.ChannelType() != "session" {
						_ = ch.Reject(gossh.UnknownChannelType, "unknown")
						continue
					}
					channel, requests, cErr := ch.Accept()
					if cErr != nil {
						return
					}
					go func(in <-chan *gossh.Request) {
						for req := range in {
							ok := false
							if req.Type == "subsystem" && len(req.Payload) > 4 && string(req.Payload[4:]) == "sftp" {
								ok = true
							}
							_ = req.Reply(ok, nil)
						}
					}(requests)
					srv := sftp.NewRequestServer(channel, handler)
					_ = srv.Serve()
					_ = srv.Close()
				}
				_ = sconn.Close()
			}(conn)
		}
	}()

	return &mockSFTPContext{
		t:      t,
		addr:   listener.Addr().String(),
		cancel: func() { _ = listener.Close() },
	}
}

func createSFTPFileService(t *testing.T, sftpCtx *mockSFTPContext) (*FileService, *model.Session) {
	t.Helper()
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	port := parsePort(t, sftpCtx.addr)
	sess := model.Session{
		Name: "sftp-test", Host: "127.0.0.1", Port: port, Username: "test",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())
	return svc, created
}

func TestFileService_ListDirSFTP(t *testing.T) {
	sftpCtx := startSFTPTestServer(t)
	defer sftpCtx.cancel()

	svc, sess := createSFTPFileService(t, sftpCtx)

	entries, err := svc.ListDir(sess.ID, "/")
	require.NoError(t, err)
	assert.NotNil(t, entries)
}

func TestFileService_IntegratedSFTP(t *testing.T) {
	sftpCtx := startSFTPTestServer(t)
	defer sftpCtx.cancel()

	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	port := parsePort(t, sftpCtx.addr)
	sess := model.Session{
		Name: "sftp-integrated", Host: "127.0.0.1", Port: port, Username: "test",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	entries, err := svc.ListDir(created.ID, "/")
	require.NoError(t, err)
	assert.NotNil(t, entries)

	err = svc.Mkdir(created.ID, "/shareddir")
	require.NoError(t, err)

	entries, err = svc.ListDir(created.ID, "/")
	require.NoError(t, err)
	found := false
	for _, e := range entries {
		if e.Name == "shareddir" && e.IsDir {
			found = true
		}
	}
	assert.True(t, found, "shareddir should be found in listing")

	err = svc.Rename(created.ID, "/shareddir", "/renameddir")
	require.NoError(t, err)

	err = svc.Delete(created.ID, "/renameddir")
	require.NoError(t, err)
}

func TestNewFileService(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	bus := newMockEventBus()
	svc := NewFileService(sessionSvc, bus, testutil.NewTestLogger())

	assert.NotNil(t, svc)
	assert.NotNil(t, svc.tasks)
	assert.Equal(t, 0, len(svc.tasks))
}

func TestFileService_ListDir(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-file", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	_, err = svc.ListDir(created.ID, "/")
	assert.Error(t, err)
}

func TestFileService_ListDirSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	_, err := svc.ListDir(999, "/")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "list dir")
}

func TestFileService_Delete(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-file", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err = svc.Delete(created.ID, "/tmp/nonexistent-file-that-should-fail")
	assert.Error(t, err)
}

func TestFileService_Mkdir(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-file", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err = svc.Mkdir(created.ID, "/tmp/newdir")
	assert.Error(t, err)
}

func TestFileService_Rename(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-file", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err = svc.Rename(created.ID, "/tmp/old", "/tmp/new")
	assert.Error(t, err)
}

func TestFileService_Upload(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

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
	svc := NewFileService(sessionSvc, b, testutil.NewTestLogger())

	taskID, err := svc.Upload(created.ID, tmpFile, "/tmp/uploaded.dat")
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
	assert.Contains(t, taskID, "file-")
}

func TestFileService_UploadSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
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
	sessionSvc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

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
	svc := NewFileService(sessionSvc, b, testutil.NewTestLogger())

	localPath := filepath.Join(t.TempDir(), "downloaded.dat")
	taskID, err := svc.Download(created.ID, "/tmp/source.dat", localPath)
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
}

func TestFileService_DownloadSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	localPath := filepath.Join(t.TempDir(), "downloaded.dat")
	_, err := svc.Download(999, "/tmp/source.dat", localPath)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "download")
}

func TestFileService_CancelTransfer(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, "", nil, testutil.NewTestLogger())

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
	svc := NewFileService(sessionSvc, b, testutil.NewTestLogger())

	taskID, err := svc.Upload(created.ID, tmpFile, "/tmp/uploaded.dat")
	require.NoError(t, err)

	err = svc.CancelTransfer(taskID)
	require.NoError(t, err)
}

func TestFileService_CancelTransferNotFound(t *testing.T) {
	svc := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	err := svc.CancelTransfer("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestFileService_DeleteSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err := svc.Delete(999, "/tmp/file")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "delete")
}

func TestFileService_MkdirSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err := svc.Mkdir(999, "/tmp/dir")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "mkdir")
}

func TestFileService_RenameSessionNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
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
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
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
