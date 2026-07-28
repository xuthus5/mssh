package service

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestRunSystemInfoCommandStopsOversizedSSHOutput(t *testing.T) {
	const serverOutputBytes = int64(maxSystemProbeOutput * 4)
	address, written, done, serverErrors := startSystemProbeSSHServer(t, serverOutputBytes)
	client, err := gossh.Dial("tcp", address, &gossh.ClientConfig{
		User:            "test",
		HostKeyCallback: gossh.InsecureIgnoreHostKey(), //nolint:gosec // 测试服务器使用临时主机密钥。
		Timeout:         time.Second,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	output, err := runSystemInfoCommand(&ssh.ClientWrapper{Inner: client}, "probe")

	assert.Nil(t, output)
	assert.ErrorContains(t, err, "output exceeds")
	waitSystemProbeServer(t, done, serverErrors)
	assert.Less(t, written.Load(), serverOutputBytes)
}

func TestRunSystemInfoCommandTimeoutWaitsForSSHSessionExit(t *testing.T) {
	original := systemProbeTimeout
	systemProbeTimeout = 20 * time.Millisecond
	t.Cleanup(func() { systemProbeTimeout = original })
	address, _, done, serverErrors := startSystemProbeSSHServer(t, -1)
	client, err := gossh.Dial("tcp", address, &gossh.ClientConfig{
		User:            "test",
		HostKeyCallback: gossh.InsecureIgnoreHostKey(), //nolint:gosec // 测试服务器使用临时主机密钥。
		Timeout:         time.Second,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	output, err := runSystemInfoCommand(&ssh.ClientWrapper{Inner: client}, "probe")

	assert.Nil(t, output)
	assert.ErrorContains(t, err, "probe timeout")
	waitSystemProbeServer(t, done, serverErrors)
}

func TestRunSystemInfoCommandRejectsUnavailableClient(t *testing.T) {
	_, err := runSystemInfoCommand(nil, "probe")

	assert.ErrorContains(t, err, "unavailable")
}

func startSystemProbeSSHServer(t *testing.T, outputBytes int64) (string, *atomic.Int64, <-chan struct{}, <-chan error) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	written := &atomic.Int64{}
	done := make(chan struct{})
	serverErrors := make(chan error, 1)
	t.Cleanup(func() { _ = listener.Close() })
	go serveSystemProbeSSH(listener, outputBytes, written, done, serverErrors)
	return listener.Addr().String(), written, done, serverErrors
}

func serveSystemProbeSSH(listener net.Listener, outputBytes int64, written *atomic.Int64, done chan<- struct{}, serverErrors chan<- error) {
	defer close(done)
	connection, err := listener.Accept()
	if err != nil {
		if !errors.Is(err, net.ErrClosed) {
			serverErrors <- err
		}
		return
	}
	defer func() { _ = connection.Close() }()
	config, err := systemProbeSSHServerConfig()
	if err != nil {
		serverErrors <- err
		return
	}
	server, channels, requests, err := gossh.NewServerConn(connection, config)
	if err != nil {
		serverErrors <- err
		return
	}
	defer func() { _ = server.Close() }()
	go gossh.DiscardRequests(requests)
	newChannel, ok := <-channels
	if !ok || newChannel.ChannelType() != "session" {
		serverErrors <- errors.New("system probe session channel is required")
		return
	}
	channel, channelRequests, err := newChannel.Accept()
	if err != nil {
		serverErrors <- err
		return
	}
	defer func() { _ = channel.Close() }()
	serveSystemProbeExec(channel, channelRequests, outputBytes, written, serverErrors)
}

func systemProbeSSHServerConfig() (*gossh.ServerConfig, error) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	signer, err := gossh.NewSignerFromKey(privateKey)
	if err != nil {
		return nil, err
	}
	config := &gossh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	return config, nil
}

func serveSystemProbeExec(channel gossh.Channel, requests <-chan *gossh.Request, outputBytes int64, written *atomic.Int64, serverErrors chan<- error) {
	for request := range requests {
		if request.Type != "exec" {
			_ = request.Reply(false, nil)
			continue
		}
		if err := request.Reply(true, nil); err != nil {
			serverErrors <- err
			return
		}
		if outputBytes < 0 {
			waitForSystemProbeSessionClose(channel)
			return
		}
		if err := writeSystemProbeOutput(channel, outputBytes, written); err != nil && !errors.Is(err, io.EOF) {
			serverErrors <- err
		}
		return
	}
}

func waitForSystemProbeSessionClose(channel gossh.Channel) {
	for {
		if _, err := channel.Write([]byte("x")); err != nil {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func writeSystemProbeOutput(channel gossh.Channel, outputBytes int64, written *atomic.Int64) error {
	chunk := bytes.Repeat([]byte("x"), 64*1024)
	for remaining := outputBytes; remaining > 0; {
		requested := min(int64(len(chunk)), remaining)
		count, err := channel.Write(chunk[:requested])
		written.Add(int64(count))
		remaining -= int64(count)
		if err != nil {
			return nil
		}
		if count == 0 {
			return io.ErrNoProgress
		}
	}
	payload := make([]byte, 4)
	binary.BigEndian.PutUint32(payload, 0)
	_, err := channel.SendRequest("exit-status", false, payload)
	if err != nil {
		return fmt.Errorf("send exit status: %w", err)
	}
	return nil
}

func waitSystemProbeServer(t *testing.T, done <-chan struct{}, serverErrors <-chan error) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("system probe SSH server did not stop")
	}
	select {
	case err := <-serverErrors:
		require.NoError(t, err)
	default:
	}
}
