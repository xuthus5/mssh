package ssh

import (
	"io"
	"net"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJumpHostTransportPreservesAddressesAndForwardsData(t *testing.T) {
	forwarded, remote := net.Pipe()
	t.Cleanup(func() { _ = remote.Close() })
	jump := newClientWrapper(nil, nil)
	transport := newJumpHostTransport(forwarded, jump)
	t.Cleanup(func() { _ = transport.Close() })
	assert.Equal(t, forwarded.LocalAddr(), transport.LocalAddr())
	assert.Equal(t, forwarded.RemoteAddr(), transport.RemoteAddr())
	go func() { _, _ = io.Copy(remote, remote) }()
	require.NoError(t, transport.SetDeadline(time.Now().Add(time.Second)))
	written, err := transport.Write([]byte("echo"))
	require.NoError(t, err)
	assert.Equal(t, 4, written)
	response := make([]byte, written)
	_, err = io.ReadFull(transport, response)
	require.NoError(t, err)
	assert.Equal(t, "echo", string(response))
}

func TestJumpHostTransportSupportsReadAndWriteDeadlines(t *testing.T) {
	for _, operation := range []string{"read", "write"} {
		t.Run(operation, func(t *testing.T) {
			forwarded, remote := net.Pipe()
			t.Cleanup(func() { _ = remote.Close() })
			transport := newJumpHostTransport(forwarded, newClientWrapper(nil, nil))
			t.Cleanup(func() { _ = transport.Close() })
			deadline := time.Now().Add(20 * time.Millisecond)
			var err error
			if operation == "read" {
				require.NoError(t, transport.SetReadDeadline(deadline))
				_, err = transport.Read(make([]byte, 1))
			} else {
				require.NoError(t, transport.SetWriteDeadline(deadline))
				const blockedPayloadSize = 1 << 20
				_, err = transport.Write(make([]byte, blockedPayloadSize))
			}
			require.ErrorIs(t, err, os.ErrDeadlineExceeded)
		})
	}
}

func TestJumpHostTransportCloseWaitsForParentLifecycle(t *testing.T) {
	forwarded, remote := net.Pipe()
	t.Cleanup(func() { _ = remote.Close() })
	jump := newClientWrapper(nil, nil)
	release := make(chan struct{})
	jump.keepAliveWG.Add(1)
	go func() { <-release; jump.keepAliveWG.Done() }()
	transport := newJumpHostTransport(forwarded, jump)
	result := make(chan error, 1)
	go func() { result <- transport.Close() }()
	waitJumpSignal(t, jump.Done())
	select {
	case <-result:
		close(release)
		t.Fatal("transport close returned before jump lifecycle stopped")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	require.NoError(t, <-result)
	transport.workers.Wait()
}

func TestJumpHostTransportCloseIsConcurrentAndIdempotent(t *testing.T) {
	forwarded, remote := net.Pipe()
	t.Cleanup(func() { _ = remote.Close() })
	jump := newClientWrapper(nil, nil)
	transport := newJumpHostTransport(forwarded, jump)
	const closers = 10
	results := make(chan error, closers)
	var workers sync.WaitGroup
	workers.Add(closers)
	for range closers {
		go func() { defer workers.Done(); results <- transport.Close() }()
	}
	workers.Wait()
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	waitJumpSignal(t, jump.Done())
	_, err := remote.Write([]byte("closed"))
	require.ErrorIs(t, err, io.ErrClosedPipe)
}
