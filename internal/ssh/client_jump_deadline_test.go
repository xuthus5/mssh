package ssh

import (
	"context"
	"io"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func TestConnectViaJumpHostAllowsHostKeyConfirmationPastNetworkTimeout(t *testing.T) {
	target := newJumpTestEndpoint(t, newJumpServerConfig(t, ""), rejectJumpTestSession)
	server := newJumpTestServer(t, jumpServerOptions{target: target.address})
	jump := connectTestJump(t, server)
	ctx, cancel := context.WithTimeout(t.Context(), 2*sshConnectTimeout)
	t.Cleanup(cancel)
	verify := func(_, _, _ string) bool {
		select {
		case <-time.After(sshConnectTimeout + 100*time.Millisecond):
			return true
		case <-ctx.Done():
			return false
		}
	}
	client, err := ConnectViaJumpHost(ctx, model.Session{
		Host: "private.target.invalid", Port: 22, Username: "target",
	}, JumpHostConnectOptions{
		JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t), HostKey: HostKeyOptions{OnNewHostKey: verify},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })
	cancel()
	_, _, err = client.Inner.SendRequest("still-connected", true, nil)
	require.NoError(t, err, "the establishment context must not cancel an established connection")
}

func TestConnectViaJumpHostCancellationDuringFingerprintClosesJump(t *testing.T) {
	target := newJumpTestEndpoint(t, newJumpServerConfig(t, ""), rejectJumpTestSession)
	server := newJumpTestServer(t, jumpServerOptions{target: target.address})
	jump := connectTestJump(t, server)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	started := make(chan struct{})
	verify := func(_, _, _ string) bool { close(started); <-ctx.Done(); return false }
	options := JumpHostConnectOptions{
		JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t), HostKey: HostKeyOptions{OnNewHostKey: verify},
	}
	result := make(chan error, 1)
	go func() {
		_, err := ConnectViaJumpHost(ctx, model.Session{Host: "private.target.invalid", Port: 22}, options)
		result <- err
	}()
	waitJumpSignal(t, started)
	cancel()
	require.ErrorIs(t, <-result, context.Canceled)
	waitJumpSignal(t, jump.Done())
	waitJumpSignal(t, target.closed)
}

func TestConnectViaJumpHostHandshakeHonorsContextDeadline(t *testing.T) {
	address, closed := newUnresponsiveJumpTarget(t)
	server := newJumpTestServer(t, jumpServerOptions{target: address})
	jump := connectTestJump(t, server)
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	t.Cleanup(cancel)
	_, err := ConnectViaJumpHost(ctx, model.Session{Host: "private.target.invalid", Port: 22}, JumpHostConnectOptions{
		JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t),
	})
	require.ErrorIs(t, err, context.DeadlineExceeded)
	waitJumpSignal(t, jump.Done())
	waitJumpSignal(t, closed)
}

func TestConnectViaJumpHostEstablishedDeadlineClosesBothClients(t *testing.T) {
	target := newJumpTestEndpoint(t, newJumpServerConfig(t, ""), rejectJumpTestSession)
	server := newJumpTestServer(t, jumpServerOptions{target: target.address})
	jump := connectTestJump(t, server)
	client, err := ConnectViaJumpHost(t.Context(), model.Session{
		Host: "private.target.invalid", Port: 22, Username: "target",
	}, JumpHostConnectOptions{
		JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t), HostKey: HostKeyOptions{Policy: HostKeyPolicyTrust},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })
	require.NoError(t, client.SetDeadline(time.Now().Add(20*time.Millisecond)))
	waitJumpSignal(t, client.Done())
	waitJumpSignal(t, jump.Done())
	waitJumpSignal(t, target.closed)
}

func newUnresponsiveJumpTarget(t *testing.T) (string, <-chan struct{}) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		_, _ = io.Copy(io.Discard, conn)
		_ = conn.Close()
	}()
	t.Cleanup(func() { _ = listener.Close(); waitJumpSignal(t, closed) })
	return listener.Addr().String(), closed
}
