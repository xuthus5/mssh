package ssh

import (
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
)

func TestClientWrapperCloseDoesNotWaitForStuckKeepAliveRequest(t *testing.T) {
	connection := newStuckKeepAliveConn()
	channels := make(chan gossh.NewChannel)
	requests := make(chan *gossh.Request)
	close(channels)
	close(requests)
	wrapper := newClientWrapper(gossh.NewClient(connection, channels, requests), nil)
	wrapper.keepAliveWG.Add(1)
	go func() {
		defer wrapper.keepAliveWG.Done()
		wrapper.startKeepAliveWithTimeout(time.Millisecond, 20*time.Millisecond, nil)
	}()
	<-connection.sendStarted

	closed := make(chan error, 1)
	go func() { closed <- wrapper.Close() }()
	select {
	case err := <-closed:
		require.NoError(t, err)
	case <-time.After(200 * time.Millisecond):
		close(connection.releaseSend)
		<-closed
		t.Fatal("client close waited indefinitely for a stuck keep-alive request")
	}
	close(connection.releaseSend)
}

type stuckKeepAliveConn struct {
	sendStarted chan struct{}
	releaseSend chan struct{}
	closed      chan struct{}
	startOnce   sync.Once
	closeOnce   sync.Once
}

func newStuckKeepAliveConn() *stuckKeepAliveConn {
	return &stuckKeepAliveConn{
		sendStarted: make(chan struct{}),
		releaseSend: make(chan struct{}),
		closed:      make(chan struct{}),
	}
}

func (connection *stuckKeepAliveConn) SendRequest(string, bool, []byte) (bool, []byte, error) {
	connection.startOnce.Do(func() { close(connection.sendStarted) })
	<-connection.releaseSend
	return false, nil, errors.New("released stuck request")
}

func (connection *stuckKeepAliveConn) OpenChannel(string, []byte) (gossh.Channel, <-chan *gossh.Request, error) {
	return nil, nil, errors.New("not implemented")
}

func (connection *stuckKeepAliveConn) Close() error {
	connection.closeOnce.Do(func() { close(connection.closed) })
	return nil
}

func (connection *stuckKeepAliveConn) Wait() error {
	<-connection.closed
	return nil
}

func (connection *stuckKeepAliveConn) User() string { return "test" }

func (connection *stuckKeepAliveConn) SessionID() []byte { return nil }

func (connection *stuckKeepAliveConn) ClientVersion() []byte { return nil }

func (connection *stuckKeepAliveConn) ServerVersion() []byte { return nil }

func (connection *stuckKeepAliveConn) RemoteAddr() net.Addr { return keepAliveTestAddr("remote") }

func (connection *stuckKeepAliveConn) LocalAddr() net.Addr { return keepAliveTestAddr("local") }

type keepAliveTestAddr string

func (address keepAliveTestAddr) Network() string { return "test" }

func (address keepAliveTestAddr) String() string { return string(address) }
