package ssh

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func TestClientWrapperCloseWaitsForKeepAliveWorker(t *testing.T) {
	wrapper := &ClientWrapper{}
	release := make(chan struct{})
	wrapper.keepAliveWG.Add(1)
	go func() {
		defer wrapper.keepAliveWG.Done()
		<-release
	}()
	result := make(chan error, 1)
	go func() { result <- wrapper.Close() }()

	var closeErr error
	returnedEarly := false
	select {
	case closeErr = <-result:
		returnedEarly = true
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if !returnedEarly {
		closeErr = <-result
	}

	assert.False(t, returnedEarly, "client close returned before keep-alive worker exited")
	require.NoError(t, closeErr)
}

func TestKeepAliveFailureClosesWithoutWaitingForItself(t *testing.T) {
	address, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	client, err := gossh.Dial("tcp", address, &gossh.ClientConfig{
		User:            "test",
		HostKeyCallback: gossh.InsecureIgnoreHostKey(), //nolint:gosec // 测试服务器使用临时主机密钥。
		Timeout:         time.Second,
	})
	require.NoError(t, err)
	keepAliveCtx, cancel := context.WithCancel(context.Background())
	wrapper := &ClientWrapper{Inner: client, keepAliveCtx: keepAliveCtx, keepAliveCancel: cancel}
	wrapper.keepAliveWG.Add(1)
	require.NoError(t, client.Close())
	done := make(chan struct{})
	go func() {
		defer wrapper.keepAliveWG.Done()
		defer close(done)
		wrapper.startKeepAlive(time.Millisecond, slog.Default())
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("keep-alive worker deadlocked while closing its own connection")
	}
	_ = wrapper.Close()
}
