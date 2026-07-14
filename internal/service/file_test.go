package service

import (
	"crypto/rand"
	"crypto/rsa"
	"net"
	"testing"

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

func startSFTPTestServer(t *testing.T) *mockSFTPContext {
	t.Helper()
	handler := sftp.InMemHandler()
	config := newSFTPServerConfig(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	go serveSFTPConnections(listener, config, handler)
	return &mockSFTPContext{
		t:      t,
		addr:   listener.Addr().String(),
		cancel: func() { _ = listener.Close() },
	}
}

func newSFTPServerConfig(t *testing.T) *gossh.ServerConfig {
	t.Helper()
	config := &gossh.ServerConfig{NoClientAuth: true}
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromSigner(privateKey)
	require.NoError(t, err)
	config.AddHostKey(signer)
	return config
}

func serveSFTPConnections(listener net.Listener, config *gossh.ServerConfig, handler sftp.Handlers) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		go serveSFTPConnection(conn, config, handler)
	}
}

func serveSFTPConnection(conn net.Conn, config *gossh.ServerConfig, handler sftp.Handlers) {
	serverConn, channels, requests, err := gossh.NewServerConn(conn, config)
	if err != nil {
		_ = conn.Close()
		return
	}
	go gossh.DiscardRequests(requests)
	for channel := range channels {
		serveSFTPChannel(channel, handler)
	}
	_ = serverConn.Close()
}

func serveSFTPChannel(channel gossh.NewChannel, handler sftp.Handlers) {
	if channel.ChannelType() != "session" {
		_ = channel.Reject(gossh.UnknownChannelType, "unknown")
		return
	}
	accepted, requests, err := channel.Accept()
	if err != nil {
		return
	}
	go replySFTPRequests(requests)
	server := sftp.NewRequestServer(accepted, handler)
	_ = server.Serve()
	_ = server.Close()
}

func replySFTPRequests(requests <-chan *gossh.Request) {
	for request := range requests {
		isSFTP := request.Type == "subsystem" && len(request.Payload) > 4 && string(request.Payload[4:]) == "sftp"
		_ = request.Reply(isSFTP, nil)
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
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
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
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
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
	assert.Equal(t, 0, sessionSvc.ConnectionCount())
	for _, captured := range bus.Events() {
		assert.NotEqual(t, event.ConnectionState, captured.Name)
	}
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
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
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
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
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
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
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
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	err = svc.Rename(created.ID, "/tmp/old", "/tmp/new")
	assert.Error(t, err)
}
