package ssh

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func connectTestJump(t *testing.T, server *jumpTestServer) *ClientWrapper {
	t.Helper()
	jump, err := Connect(t.Context(), model.Session{
		Host: "127.0.0.1", Port: mustParsePort(server.address), Username: "jump",
	}, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	t.Cleanup(func() { _ = jump.Close() })
	return jump
}

func TestConnectViaJumpHostForwardsAndOwnsJump(t *testing.T) {
	targetAddress, stop := testutil.NewMockServer(t)
	t.Cleanup(stop)
	server := newJumpTestServer(t, jumpServerOptions{target: targetAddress})
	jump := connectTestJump(t, server)
	target := model.Session{Host: "private.target.invalid", Port: 2202, Username: "target"}
	knownHosts := testutil.KnownHostsPath(t)
	client, err := ConnectViaJumpHost(t.Context(), target, JumpHostConnectOptions{
		JumpHost: jump, KnownHostsPath: knownHosts, HostKey: HostKeyOptions{Policy: HostKeyPolicyTrust},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })
	request := <-server.forwarded
	assert.Equal(t, target.Host, request.Host)
	assert.Equal(t, uint32(target.Port), request.Port)
	pty, err := OpenPTY(client, "xterm-256color", 80, 24)
	require.NoError(t, err)
	require.NoError(t, pty.Close())
	content, err := os.ReadFile(knownHosts)
	require.NoError(t, err)
	assert.Contains(t, string(content), "[private.target.invalid]:2202")
	assert.NotContains(t, string(content), "127.0.0.1")
	require.NoError(t, client.Close())
	waitJumpSignal(t, jump.Done())
	waitJumpSignal(t, server.closed)
}

func TestConnectViaJumpHostRefusedForwardClosesJump(t *testing.T) {
	server := newJumpTestServer(t, jumpServerOptions{reject: true})
	jump := connectTestJump(t, server)
	client, err := ConnectViaJumpHost(t.Context(), model.Session{
		Host: "private.target.invalid", Port: 22, Username: "target",
	}, JumpHostConnectOptions{JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t)})
	require.ErrorContains(t, err, "forwarding disabled")
	assert.Nil(t, client)
	waitJumpSignal(t, jump.Done())
	waitJumpSignal(t, server.closed)
}

func TestConnectViaJumpHostCancelledForwardClosesJump(t *testing.T) {
	server := newJumpTestServer(t, jumpServerOptions{wait: make(chan struct{})})
	jump := connectTestJump(t, server)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	options := JumpHostConnectOptions{JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t)}
	result := make(chan error, 1)
	go func() {
		_, err := ConnectViaJumpHost(ctx, model.Session{Host: "private.target.invalid", Port: 22}, options)
		result <- err
	}()
	<-server.forwarded
	cancel()
	require.ErrorIs(t, <-result, context.Canceled)
	waitJumpSignal(t, jump.Done())
	waitJumpSignal(t, server.closed)
}

func TestConnectViaJumpHostRejectsTargetFingerprint(t *testing.T) {
	targetAddress, stop := testutil.NewMockServer(t)
	t.Cleanup(stop)
	server := newJumpTestServer(t, jumpServerOptions{target: targetAddress})
	jump := connectTestJump(t, server)
	client, err := ConnectViaJumpHost(t.Context(), model.Session{
		Host: "private.target.invalid", Port: 22, Username: "target",
	}, JumpHostConnectOptions{JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t)})
	require.ErrorContains(t, err, "unknown host key rejected")
	assert.Nil(t, client)
	waitJumpSignal(t, jump.Done())
	waitJumpSignal(t, server.closed)
}

func TestConnectViaJumpHostRemoteDisconnectClosesJump(t *testing.T) {
	target := newJumpTestEndpoint(t, newJumpServerConfig(t, ""), func(_ *jumpTestServer, channel gossh.NewChannel, _ <-chan struct{}) {
		_ = channel.Reject(gossh.UnknownChannelType, "unsupported")
	})
	server := newJumpTestServer(t, jumpServerOptions{target: target.address})
	jump := connectTestJump(t, server)
	client, err := ConnectViaJumpHost(t.Context(), model.Session{
		Host: "private.target.invalid", Port: 22, Username: "target",
	}, JumpHostConnectOptions{
		JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t), HostKey: HostKeyOptions{Policy: HostKeyPolicyTrust},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })
	target.disconnect()
	waitJumpSignal(t, client.Done())
	waitJumpSignal(t, jump.Done())
	waitJumpSignal(t, server.closed)
}
