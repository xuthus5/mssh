package ssh

import (
	"net"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func connectSharedJumpTarget(t *testing.T, address string) (*ClientWrapper, *ClientWrapper) {
	t.Helper()
	jump, err := Connect(t.Context(), model.Session{
		Host: "127.0.0.1", Port: mustParsePort(address), Username: "jump",
	}, nil, testutil.KnownHostsPath(t), nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = jump.Close() })
	client, err := ConnectViaJumpHost(t.Context(), model.Session{
		Host: "jump-only.internal", Port: 22, Username: "target",
	}, JumpHostConnectOptions{
		JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t), HostKey: HostKeyOptions{Policy: HostKeyPolicyTrust},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })
	return client, jump
}

func TestSharedJumpServerSupportsIndependentClientsAndStop(t *testing.T) {
	targetAddress, stopTarget := testutil.NewMockServer(t)
	t.Cleanup(stopTarget)
	address, stop := testutil.NewJumpServer(t, targetAddress)
	first, firstJump := connectSharedJumpTarget(t, address)
	second, secondJump := connectSharedJumpTarget(t, address)
	require.NoError(t, first.Close())
	waitJumpSignal(t, firstJump.Done())
	_, _, err := second.Inner.SendRequest("independent", true, nil)
	require.NoError(t, err)
	stop()
	waitJumpSignal(t, second.Done())
	waitJumpSignal(t, secondJump.Done())
	stop()
	conn, err := net.DialTimeout("tcp", address, time.Second)
	if conn != nil {
		_ = conn.Close()
	}
	require.Error(t, err)
}

func TestSharedJumpServerRejectsUnsupportedAndUnreachableChannels(t *testing.T) {
	address, _ := testutil.NewJumpServer(t, "127.0.0.1:0")
	jump, err := Connect(t.Context(), model.Session{
		Host: "127.0.0.1", Port: mustParsePort(address), Username: "jump",
	}, nil, testutil.KnownHostsPath(t), nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = jump.Close() })
	_, err = jump.Inner.NewSession()
	require.ErrorContains(t, err, "unsupported")
	client, err := ConnectViaJumpHost(t.Context(), model.Session{
		Host: "jump-only.internal", Port: 22, Username: "target",
	}, JumpHostConnectOptions{JumpHost: jump, KnownHostsPath: testutil.KnownHostsPath(t)})
	require.Error(t, err)
	assert.Nil(t, client)
	waitJumpSignal(t, jump.Done())
}

func TestSharedJumpServerStopClosesIncompleteHandshake(t *testing.T) {
	address, stop := testutil.NewJumpServer(t, "127.0.0.1:0")
	conn, err := net.DialTimeout("tcp", address, time.Second)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	_, err = conn.Write([]byte("SSH-2.0-incomplete\r\n"))
	require.NoError(t, err)
	stop()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(time.Second)))
	buffer := make([]byte, 1024)
	for err == nil {
		_, err = conn.Read(buffer)
	}
	assert.NotErrorIs(t, err, os.ErrDeadlineExceeded)
}
