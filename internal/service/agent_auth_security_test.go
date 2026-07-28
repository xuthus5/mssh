//go:build !windows

package service

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sshagent "golang.org/x/crypto/ssh/agent"
)

func TestResolveSSHAgentEndpointRejectsUnsafePaths(t *testing.T) {
	regularFile := filepath.Join(t.TempDir(), "agent.sock")
	require.NoError(t, os.WriteFile(regularFile, []byte("not a socket"), 0o600))
	tests := []string{
		"",
		"   ",
		"relative.sock",
		"bad\npath",
		strings.Repeat("x", maxSSHAgentSocketPathBytes+1),
		filepath.Join(t.TempDir(), "missing.sock"),
		regularFile,
	}
	for _, socketPath := range tests {
		_, _, err := resolveSSHAgentEndpoint(socketPath)
		require.Error(t, err)
	}
}

func TestResolveSSHAgentEndpointResolvesSocketSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "agent.sock")
	listener, err := net.Listen("unix", target)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, listener.Close()) })
	link := filepath.Join(dir, "agent-link.sock")
	require.NoError(t, os.Symlink(target, link))

	network, address, err := resolveSSHAgentEndpoint(link)

	require.NoError(t, err)
	assert.Equal(t, "unix", network)
	assert.Equal(t, target, address)
}

func TestOpenAgentAuthAtTimesOutUnresponsiveAgent(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	listener, err := net.Listen("unix", socketPath)
	require.NoError(t, err)
	accepted := make(chan net.Conn, 1)
	acceptErr := make(chan error, 1)
	go func() {
		conn, acceptError := listener.Accept()
		if acceptError != nil {
			acceptErr <- acceptError
			return
		}
		accepted <- conn
	}()
	t.Cleanup(func() { _ = listener.Close() })

	started := time.Now()
	_, err = openAgentAuthAt(context.Background(), socketPath, 40*time.Millisecond, &net.Dialer{})

	require.Error(t, err)
	assert.Less(t, time.Since(started), time.Second)
	select {
	case conn := <-accepted:
		require.NoError(t, conn.Close())
	case err := <-acceptErr:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("agent connection was not accepted")
	}
}

func TestOpenAgentAuthAtHonorsCancelledContext(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	listener, err := net.Listen("unix", socketPath)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, listener.Close()) })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err = openAgentAuthAt(ctx, socketPath, time.Second, &net.Dialer{})

	require.Error(t, err)
	assert.True(t, errors.Is(err, context.Canceled), err)
}

func TestOpenAgentAuthAtCancelsBlockedAgentRequest(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	listener, err := net.Listen("unix", socketPath)
	require.NoError(t, err)
	accepted := make(chan net.Conn, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr == nil {
			accepted <- conn
		}
	}()
	t.Cleanup(func() { _ = listener.Close() })
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, openErr := openAgentAuthAt(ctx, socketPath, 5*time.Second, &net.Dialer{})
		result <- openErr
	}()
	conn := <-accepted
	t.Cleanup(func() { _ = conn.Close() })

	cancel()
	select {
	case err := <-result:
		require.Error(t, err)
		assert.True(t, errors.Is(err, context.Canceled), err)
	case <-time.After(250 * time.Millisecond):
		_ = conn.Close()
		<-result
		t.Fatal("blocked SSH agent request ignored context cancellation")
	}
}

func TestOpenAgentAuthAtValidatesOptions(t *testing.T) {
	_, err := openAgentAuthAt(nil, "ignored", time.Second, &net.Dialer{})
	require.Error(t, err)
	_, err = openAgentAuthAt(context.Background(), "ignored", 0, &net.Dialer{})
	require.Error(t, err)
	_, err = openAgentAuthAt(context.Background(), "ignored", time.Second, nil)
	require.Error(t, err)
}

func TestOpenAgentAuthAtWrapsDialFailure(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	listener, err := net.Listen("unix", socketPath)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, listener.Close()) })
	wantErr := errors.New("dial failed")
	dialer := agentDialerFunc(func(context.Context, string, string) (net.Conn, error) {
		return nil, wantErr
	})

	_, err = openAgentAuthAt(context.Background(), socketPath, time.Second, dialer)

	require.Error(t, err)
	assert.ErrorIs(t, err, wantErr)
}

func TestOpenAgentAuthAtRejectsAgentWithoutSigners(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "agent.sock")
	listener, err := net.Listen("unix", socketPath)
	require.NoError(t, err)
	serveDone := make(chan struct{})
	go func() {
		defer close(serveDone)
		conn, acceptErr := listener.Accept()
		if acceptErr == nil {
			_ = sshagent.ServeAgent(sshagent.NewKeyring(), conn)
		}
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		<-serveDone
	})

	_, err = openAgentAuthAt(context.Background(), socketPath, time.Second, &net.Dialer{})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "no signers")
}

func TestAgentDeadlineConnReportsDeadlineErrors(t *testing.T) {
	wantErr := errors.New("deadline failed")
	conn := &agentDeadlineConn{
		Conn:    &deadlineFailureConn{readErr: wantErr, writeErr: wantErr},
		timeout: time.Second,
	}
	_, err := conn.Read(make([]byte, 1))
	assert.ErrorIs(t, err, wantErr)
	_, err = conn.Write([]byte("x"))
	assert.ErrorIs(t, err, wantErr)
}

func TestAgentAuthCloseStopsContextOnce(t *testing.T) {
	stopCalls := 0
	auth := &agentAuth{stopContext: func() bool {
		stopCalls++
		return true
	}}

	auth.Close()
	auth.Close()

	assert.Equal(t, 1, stopCalls)
}

type agentDialerFunc func(context.Context, string, string) (net.Conn, error)

func (f agentDialerFunc) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return f(ctx, network, address)
}

type deadlineFailureConn struct {
	net.Conn
	readErr  error
	writeErr error
}

func (c *deadlineFailureConn) SetReadDeadline(time.Time) error {
	return c.readErr
}

func (c *deadlineFailureConn) SetWriteDeadline(time.Time) error {
	return c.writeErr
}
