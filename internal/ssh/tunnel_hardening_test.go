package ssh

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadSOCKS5DestinationRejectsUnsupportedAuthentication(t *testing.T) {
	tests := []struct {
		name    string
		methods []byte
	}{
		{name: "no methods", methods: nil},
		{name: "password only", methods: []byte{0x02}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, accepted := exchangeSOCKS5Greeting(t, test.methods)
			assert.Equal(t, []byte{0x05, 0xff}, response)
			assert.False(t, accepted)
		})
	}
}

func TestReadSOCKS5DestinationRejectsInvalidRequestHeader(t *testing.T) {
	tests := []struct {
		name     string
		command  byte
		reserved byte
		code     byte
	}{
		{name: "unsupported command", command: 0x02, reserved: 0x00, code: 0x07},
		{name: "invalid reserved byte", command: 0x01, reserved: 0x01, code: 0x01},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, accepted, err := exchangeRejectedSOCKS5Request(test.command, test.reserved)
			require.NoError(t, err)
			assert.Equal(t, byte(0x05), response[0])
			assert.Equal(t, test.code, response[1])
			assert.False(t, accepted)
		})
	}
}

func TestHandleSOCKS5SetsHandshakeDeadline(t *testing.T) {
	connection := &deadlineRecordingConn{}

	handleSOCKS5(nil, connection)

	require.NotEmpty(t, connection.deadlines)
	assert.False(t, connection.deadlines[0].IsZero())
	assert.True(t, connection.closed)
}

func TestHandleSOCKS5ClearsHandshakeDeadlineBeforeDial(t *testing.T) {
	connection := &deadlineRecordingConn{reader: bytes.NewReader([]byte{
		0x05, 0x01, 0x00,
		0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0, 22,
	})}

	handleSOCKS5(nil, connection)

	require.Len(t, connection.deadlines, 2)
	assert.False(t, connection.deadlines[0].IsZero())
	assert.True(t, connection.deadlines[1].IsZero())
	assert.True(t, connection.closed)
}

func TestDialTunnelTargetTimesOut(t *testing.T) {
	started := time.Now()

	_, err := dialTunnelTarget(blockingContextDialer{}, "example.com:22", 20*time.Millisecond)

	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.Less(t, time.Since(started), 500*time.Millisecond)
}

func TestDialTunnelTargetValidatesInputs(t *testing.T) {
	_, err := dialTunnelTarget(nil, "example.com:22", time.Second)
	require.ErrorContains(t, err, "dialer")

	_, err = dialTunnelTarget(blockingContextDialer{}, "example.com:22", 0)
	require.ErrorContains(t, err, "positive")
}

func TestDynamicForwardCloseTerminatesActiveHandshake(t *testing.T) {
	listener, err := StartDynamicForward(nil, "127.0.0.1:0", nil)
	require.NoError(t, err)
	defer func() { _ = listener.Close() }()

	connection, err := net.Dial("tcp", listener.Addr().String())
	require.NoError(t, err)
	defer func() { _ = connection.Close() }()
	require.NoError(t, socks5Handshake(connection))

	require.NoError(t, listener.Close())
	requireConnectionClosedWithoutTimeout(t, connection)
}

func TestLocalForwardCloseTerminatesActiveConnection(t *testing.T) {
	echoAddress, stopEcho := startEchoServer(t)
	defer stopEcho()
	sshAddress, stopSSH := newSSHServer(t, forwardHandlerToEcho)
	defer stopSSH()

	client := connectToSSH(t, sshAddress)
	remoteAddress := fmt.Sprintf("127.0.0.1:%d", parsePort(echoAddress))
	listener, err := StartLocalForward(client, "127.0.0.1:0", remoteAddress, nil)
	require.NoError(t, err)
	defer func() { _ = listener.Close() }()

	connection, err := net.Dial("tcp", listener.Addr().String())
	require.NoError(t, err)
	defer func() { _ = connection.Close() }()
	sendAndExpect(t, connection, "active", "active")

	require.NoError(t, listener.Close())
	requireConnectionClosedWithoutTimeout(t, connection)
}

func TestRemoteForwardCloseTerminatesActiveConnection(t *testing.T) {
	echoAddress, stopEcho := startEchoServer(t)
	defer stopEcho()
	sshAddress, stopSSH := newRemoteCapableSSHServer(t)
	defer stopSSH()

	client := connectToSSH(t, sshAddress)
	localAddress := fmt.Sprintf("127.0.0.1:%d", parsePort(echoAddress))
	listener, err := StartRemoteForward(client, "127.0.0.1:0", localAddress, nil)
	require.NoError(t, err)
	defer func() { _ = listener.Close() }()

	connection, err := net.Dial("tcp", listener.Addr().String())
	require.NoError(t, err)
	defer func() { _ = connection.Close() }()
	sendAndExpect(t, connection, "active", "active")

	require.NoError(t, listener.Close())
	requireConnectionClosedWithoutTimeout(t, connection)
}

func requireConnectionClosedWithoutTimeout(t *testing.T, connection net.Conn) {
	t.Helper()
	require.NoError(t, connection.SetReadDeadline(time.Now().Add(300*time.Millisecond)))
	_, err := connection.Read(make([]byte, 1))
	require.Error(t, err)
	var networkError net.Error
	if errors.As(err, &networkError) {
		assert.False(t, networkError.Timeout(), "connection remained active after listener close")
	}
}

func exchangeSOCKS5Greeting(t *testing.T, methods []byte) ([]byte, bool) {
	t.Helper()
	server, client := net.Pipe()
	result := make(chan bool, 1)
	go func() {
		defer func() { _ = server.Close() }()
		_, accepted := readSOCKS5Destination(server)
		result <- accepted
	}()
	require.NoError(t, client.SetDeadline(time.Now().Add(time.Second)))
	request := append([]byte{0x05, byte(len(methods))}, methods...)
	_, err := client.Write(request)
	require.NoError(t, err)
	response := make([]byte, 2)
	_, err = io.ReadFull(client, response)
	require.NoError(t, err)
	require.NoError(t, client.Close())
	return response, <-result
}

func exchangeRejectedSOCKS5Request(command, reserved byte) ([]byte, bool, error) {
	server, client := net.Pipe()
	result := make(chan bool, 1)
	go func() {
		defer func() { _ = server.Close() }()
		_, accepted := readSOCKS5Destination(server)
		result <- accepted
	}()
	if err := client.SetDeadline(time.Now().Add(time.Second)); err != nil {
		return nil, false, err
	}
	if _, err := client.Write([]byte{0x05, 0x01, 0x00}); err != nil {
		return nil, false, err
	}
	selection := make([]byte, 2)
	if _, err := io.ReadFull(client, selection); err != nil {
		return nil, false, err
	}
	request := []byte{0x05, command, reserved, 0x01}
	if _, err := client.Write(request); err != nil {
		return nil, false, err
	}
	response := make([]byte, 10)
	_, readErr := io.ReadFull(client, response)
	_ = client.Close()
	return response, <-result, readErr
}

type blockingContextDialer struct{}

func (blockingContextDialer) DialContext(ctx context.Context, _, _ string) (net.Conn, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

type deadlineRecordingConn struct {
	deadlines []time.Time
	closed    bool
	reader    *bytes.Reader
}

func (c *deadlineRecordingConn) Read(content []byte) (int, error) {
	if c.reader == nil {
		return 0, io.EOF
	}
	return c.reader.Read(content)
}

func (c *deadlineRecordingConn) Write(content []byte) (int, error) { return len(content), nil }

func (c *deadlineRecordingConn) Close() error { c.closed = true; return nil }

func (c *deadlineRecordingConn) LocalAddr() net.Addr { return stubNetworkAddress("local") }

func (c *deadlineRecordingConn) RemoteAddr() net.Addr { return stubNetworkAddress("remote") }

func (c *deadlineRecordingConn) SetDeadline(deadline time.Time) error {
	c.deadlines = append(c.deadlines, deadline)
	return nil
}

func (c *deadlineRecordingConn) SetReadDeadline(time.Time) error { return nil }

func (c *deadlineRecordingConn) SetWriteDeadline(time.Time) error { return nil }

type stubNetworkAddress string

func (a stubNetworkAddress) Network() string { return "test" }

func (a stubNetworkAddress) String() string { return string(a) }
