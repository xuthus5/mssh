package service

import (
	"errors"
	"net"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/pkg/event"
)

type retryableSSHConn struct {
	mu         sync.Mutex
	closeErr   error
	closeCalls int
}

type failingSSHConn struct {
	closeErr error
}

func (c *failingSSHConn) User() string { return "test" }

func (c *failingSSHConn) SessionID() []byte { return nil }

func (c *failingSSHConn) ClientVersion() []byte { return nil }

func (c *failingSSHConn) ServerVersion() []byte { return nil }

func (c *failingSSHConn) RemoteAddr() net.Addr { return &net.TCPAddr{} }

func (c *failingSSHConn) LocalAddr() net.Addr { return &net.TCPAddr{} }

func (c *failingSSHConn) Wait() error { return nil }

func (c *failingSSHConn) Close() error { return c.closeErr }

func (c *failingSSHConn) SendRequest(string, bool, []byte) (bool, []byte, error) {
	return false, nil, nil
}

func (c *failingSSHConn) OpenChannel(string, []byte) (gossh.Channel, <-chan *gossh.Request, error) {
	return nil, nil, errors.New("not implemented")
}

func (c *retryableSSHConn) User() string { return "test" }

func (c *retryableSSHConn) SessionID() []byte { return nil }

func (c *retryableSSHConn) ClientVersion() []byte { return nil }

func (c *retryableSSHConn) ServerVersion() []byte { return nil }

func (c *retryableSSHConn) RemoteAddr() net.Addr { return &net.TCPAddr{} }

func (c *retryableSSHConn) LocalAddr() net.Addr { return &net.TCPAddr{} }

func (c *retryableSSHConn) Wait() error { return nil }

func (c *retryableSSHConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closeCalls++
	if c.closeCalls == 1 {
		return c.closeErr
	}
	return nil
}

func (c *retryableSSHConn) CloseCalls() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closeCalls
}

func (c *retryableSSHConn) SendRequest(string, bool, []byte) (bool, []byte, error) {
	return false, nil, nil
}

func (c *retryableSSHConn) OpenChannel(string, []byte) (gossh.Channel, <-chan *gossh.Request, error) {
	return nil, nil, errors.New("not implemented")
}

func TestSessionServiceDisconnectRetainsConnectionAfterCloseErrorAndRetries(t *testing.T) {
	closeErr := errors.New("client close failed")
	connection := &retryableSSHConn{closeErr: closeErr}
	bus := newMockEventBus()
	service := NewSessionService(nil, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	service.conns["conn-1"] = newManagedSSHConnection(connection)

	err := service.disconnect("conn-1", true)
	require.ErrorIs(t, err, closeErr)
	assert.Equal(t, 1, service.ConnectionCount())
	assert.False(t, bus.hasEvent(event.ConnectionState))
	assert.Equal(t, 1, connection.CloseCalls())

	require.NoError(t, service.disconnect("conn-1", true))
	assert.Equal(t, 0, service.ConnectionCount())
	assert.Equal(t, 2, connection.CloseCalls())
	assert.Equal(t, 1, connectionStateEventCount(bus))
}

func TestSessionServiceDisconnectRemovesAlreadyClosedTransport(t *testing.T) {
	bus := newMockEventBus()
	service := NewSessionService(nil, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	service.conns["conn-1"] = newManagedSSHConnection(&failingSSHConn{closeErr: net.ErrClosed})

	require.NoError(t, service.disconnect("conn-1", true))

	assert.Equal(t, 0, service.ConnectionCount())
	assert.Equal(t, 1, connectionStateEventCount(bus))
}

func TestSessionServiceDisconnectDoesNotRemoveReplacementConnection(t *testing.T) {
	closeStarted := make(chan struct{})
	releaseClose := make(chan struct{})
	originalConnection := &managedConn{cleanup: func() {
		close(closeStarted)
		<-releaseClose
	}}
	replacementConnection := &managedConn{}
	bus := newMockEventBus()
	service := NewSessionService(nil, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	service.conns["conn-1"] = originalConnection

	disconnectDone := make(chan error, 1)
	go func() { disconnectDone <- service.disconnect("conn-1", true) }()
	<-closeStarted
	service.mu.Lock()
	service.conns["conn-1"] = replacementConnection
	service.mu.Unlock()
	close(releaseClose)

	require.NoError(t, <-disconnectDone)
	service.mu.RLock()
	registeredConnection := service.conns["conn-1"]
	service.mu.RUnlock()
	assert.Same(t, replacementConnection, registeredConnection)
	assert.Equal(t, 0, connectionStateEventCount(bus))
}

func TestSessionServiceConcurrentDisconnectEmitsStateOnce(t *testing.T) {
	bus := newMockEventBus()
	service := NewSessionService(nil, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	service.conns["conn-1"] = &managedConn{}
	start := make(chan struct{})
	results := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			results <- service.disconnect("conn-1", true)
		}()
	}
	close(start)

	for range 2 {
		if err := <-results; err != nil {
			assert.ErrorContains(t, err, "terminal conn-1 not found")
		}
	}
	assert.Equal(t, 0, service.ConnectionCount())
	assert.Equal(t, 1, connectionStateEventCount(bus))
}

func newManagedSSHConnection(connection gossh.Conn) *managedConn {
	channels := make(chan gossh.NewChannel)
	requests := make(chan *gossh.Request)
	close(channels)
	close(requests)
	client := gossh.NewClient(connection, channels, requests)
	return &managedConn{wrapper: &ssh.ClientWrapper{Inner: client}}
}

func connectionStateEventCount(bus *mockEventBus) int {
	count := 0
	for _, captured := range bus.Events() {
		if captured.Name == event.ConnectionState {
			count++
		}
	}
	return count
}
