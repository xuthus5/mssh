package ssh

import (
	"context"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTunnelListenerCloseWaitsForActiveHandler(t *testing.T) {
	rawListener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	handlerStarted := make(chan struct{})
	releaseHandler := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseHandler) }) }

	listener := startTunnelListener(rawListener, func(context.Context, net.Conn) {
		close(handlerStarted)
		<-releaseHandler
	}, nil)
	t.Cleanup(func() {
		release()
		_ = listener.Close()
	})
	connection, err := net.Dial("tcp", listener.Addr().String())
	require.NoError(t, err)
	defer func() { _ = connection.Close() }()
	select {
	case <-handlerStarted:
	case <-time.After(time.Second):
		t.Fatal("tunnel handler did not start")
	}

	closeResult := make(chan error, 1)
	go func() { closeResult <- listener.Close() }()
	requireConnectionClosedWithoutTimeout(t, connection)
	select {
	case closeErr := <-closeResult:
		t.Fatalf("listener close returned before handler exit: %v", closeErr)
	case <-time.After(50 * time.Millisecond):
	}

	release()
	select {
	case closeErr := <-closeResult:
		require.NoError(t, closeErr)
	case <-time.After(time.Second):
		t.Fatal("listener close did not return after handler exit")
	}
}

func TestTunnelListenerOnExitMayCloseListener(t *testing.T) {
	rawListener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	callbackResult := make(chan error, 1)
	var listener *tunnelListener
	listener = startTunnelListener(rawListener, func(context.Context, net.Conn) {}, func() {
		callbackResult <- listener.Close()
	})

	require.NoError(t, listener.Close())
	select {
	case callbackErr := <-callbackResult:
		require.NoError(t, callbackErr)
	case <-time.After(time.Second):
		t.Fatal("accept-exit callback deadlocked while closing listener")
	}
}

func TestDialTunnelTargetContextCancelsImmediately(t *testing.T) {
	dialer := &cancellationAwareDialer{started: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, dialErr := dialTunnelTargetContext(ctx, dialer, "example.com:22", time.Minute)
		result <- dialErr
	}()
	select {
	case <-dialer.started:
	case <-time.After(time.Second):
		t.Fatal("tunnel dial did not start")
	}

	cancel()
	select {
	case dialErr := <-result:
		assert.ErrorIs(t, dialErr, context.Canceled)
	case <-time.After(time.Second):
		t.Fatal("tunnel dial did not stop after cancellation")
	}
}

func TestDialTunnelTargetContextRequiresParent(t *testing.T) {
	_, err := dialTunnelTargetContext(nil, blockingContextDialer{}, "example.com:22", time.Second)
	require.ErrorContains(t, err, "context")
}

func TestTunnelConnectionPreservesHalfClose(t *testing.T) {
	client, server := newTCPConnectionPair(t)
	connection := &tunnelConnection{Conn: server}

	require.NoError(t, connection.CloseWrite())
	require.NoError(t, client.SetReadDeadline(time.Now().Add(time.Second)))
	_, err := client.Read(make([]byte, 1))
	assert.ErrorIs(t, err, io.EOF)
}

func TestCopyBidirectionalContextStopsOnCancel(t *testing.T) {
	firstPeer, firstTunnel := net.Pipe()
	secondTunnel, secondPeer := net.Pipe()
	defer func() { _ = firstPeer.Close() }()
	defer func() { _ = secondPeer.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		copyBidirectionalContext(ctx, firstTunnel, secondTunnel)
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("bidirectional copy did not stop after cancellation")
	}
}

type cancellationAwareDialer struct {
	started chan struct{}
}

func (d *cancellationAwareDialer) DialContext(ctx context.Context, _, _ string) (net.Conn, error) {
	close(d.started)
	<-ctx.Done()
	return nil, ctx.Err()
}
