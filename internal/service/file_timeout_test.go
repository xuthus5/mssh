package service

import (
	"net"
	"sync"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type blockingSFTPFileLister struct {
	delegate sftp.FileLister
	release  <-chan struct{}
}

func (h blockingSFTPFileLister) Filelist(request *sftp.Request) (sftp.ListerAt, error) {
	<-h.release
	return h.delegate.Filelist(request)
}

type blockingSFTPFileCmder struct {
	delegate sftp.FileCmder
	release  <-chan struct{}
}

func (h blockingSFTPFileCmder) Filecmd(request *sftp.Request) error {
	<-h.release
	return h.delegate.Filecmd(request)
}

func startBlockingSFTPTestServer(t *testing.T) *mockSFTPContext {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	release := make(chan struct{})
	handlers := sftp.InMemHandler()
	handlers.FileList = blockingSFTPFileLister{delegate: handlers.FileList, release: release}
	handlers.FileCmd = blockingSFTPFileCmder{delegate: handlers.FileCmd, release: release}
	go serveSFTPConnections(listener, newSFTPServerConfig(t), handlers)
	var closeOnce sync.Once
	return &mockSFTPContext{t: t, addr: listener.Addr().String(), cancel: func() {
		closeOnce.Do(func() {
			close(release)
			_ = listener.Close()
		})
	}}
}

func TestFileServiceMetadataOperationsTimeOutWhenSFTPServerStalls(t *testing.T) {
	server := startBlockingSFTPTestServer(t)
	defer server.cancel()
	service, session := createSFTPFileService(t, server)
	previousTimeout := sftpMetadataOperationTimeout
	sftpMetadataOperationTimeout = 80 * time.Millisecond
	t.Cleanup(func() { sftpMetadataOperationTimeout = previousTimeout })

	operations := []struct {
		name string
		run  func() error
	}{
		{name: "list", run: func() error { _, err := service.ListDir(session.ID, "/"); return err }},
		{name: "delete", run: func() error { return service.Delete(session.ID, "/file") }},
		{name: "mkdir", run: func() error { return service.Mkdir(session.ID, "/dir") }},
		{name: "rename", run: func() error { return service.Rename(session.ID, "/old", "/new") }},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			started := time.Now()
			err := operation.run()
			require.Error(t, err)
			assert.ErrorContains(t, err, "timed out")
			assert.Less(t, time.Since(started), time.Second)
			assert.Equal(t, 0, service.sessions.ConnectionCount())
		})
	}
}
