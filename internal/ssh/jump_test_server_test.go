package ssh

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
)

type jumpForwardRequest struct {
	Host       string
	Port       uint32
	OriginHost string
	OriginPort uint32
}

type jumpServerOptions struct {
	target string
	reject bool
	wait   <-chan struct{}
}

type jumpTestServer struct {
	address   string
	listener  net.Listener
	accepted  chan net.Conn
	closed    chan struct{}
	forwarded chan jumpForwardRequest
	stopOnce  sync.Once
	workers   sync.WaitGroup
}

func newJumpServerConfig(t *testing.T, password string) *gossh.ServerConfig {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromKey(privateKey)
	require.NoError(t, err)
	config := &gossh.ServerConfig{NoClientAuth: password == ""}
	if password != "" {
		config.PasswordCallback = func(_ gossh.ConnMetadata, provided []byte) (*gossh.Permissions, error) {
			if string(provided) != password {
				return nil, errors.New("invalid password")
			}
			return nil, nil
		}
	}
	config.AddHostKey(signer)
	return config
}

func newJumpTestServer(t *testing.T, options jumpServerOptions) *jumpTestServer {
	t.Helper()
	return newJumpTestEndpoint(t, newJumpServerConfig(t, ""), func(server *jumpTestServer, channel gossh.NewChannel, disconnected <-chan struct{}) {
		if channel.ChannelType() != "direct-tcpip" {
			_ = channel.Reject(gossh.UnknownChannelType, "unsupported")
			return
		}
		server.forwardChannel(channel, options, disconnected)
	})
}

func newJumpTestEndpoint(t *testing.T, config *gossh.ServerConfig, handle func(*jumpTestServer, gossh.NewChannel, <-chan struct{})) *jumpTestServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	server := &jumpTestServer{
		address: listener.Addr().String(), listener: listener,
		accepted: make(chan net.Conn, 1), closed: make(chan struct{}),
		forwarded: make(chan jumpForwardRequest, 1),
	}
	go server.serve(config, handle)
	t.Cleanup(func() {
		server.disconnect()
		waitJumpSignal(t, server.closed)
	})
	return server
}

func (s *jumpTestServer) serve(config *gossh.ServerConfig, handle func(*jumpTestServer, gossh.NewChannel, <-chan struct{})) {
	defer close(s.closed)
	conn, err := s.listener.Accept()
	if err != nil {
		return
	}
	s.accepted <- conn
	defer func() { _ = conn.Close() }()
	server, channels, requests, err := gossh.NewServerConn(conn, config)
	if err != nil {
		return
	}
	disconnected := make(chan struct{})
	go func() { _ = server.Wait(); close(disconnected) }()
	go gossh.DiscardRequests(requests)
	for channel := range channels {
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			handle(s, channel, disconnected)
		}()
	}
	s.workers.Wait()
}

func (s *jumpTestServer) disconnect() {
	s.stopOnce.Do(func() {
		_ = s.listener.Close()
		select {
		case conn := <-s.accepted:
			_ = conn.Close()
		case <-s.closed:
		}
	})
}

func (s *jumpTestServer) forwardChannel(channel gossh.NewChannel, options jumpServerOptions, disconnected <-chan struct{}) {
	var request jumpForwardRequest
	if err := gossh.Unmarshal(channel.ExtraData(), &request); err != nil {
		_ = channel.Reject(gossh.ConnectionFailed, "invalid request")
		return
	}
	s.forwarded <- request
	if options.wait != nil {
		select {
		case <-options.wait:
		case <-disconnected:
			return
		}
	}
	if options.reject {
		_ = channel.Reject(gossh.Prohibited, "forwarding disabled")
		return
	}
	target, err := net.DialTimeout("tcp", options.target, time.Second)
	if err != nil {
		_ = channel.Reject(gossh.ConnectionFailed, err.Error())
		return
	}
	forwarded, requests, err := channel.Accept()
	if err != nil {
		_ = target.Close()
		return
	}
	go gossh.DiscardRequests(requests)
	copyJumpTestForward(forwarded, target)
}

func copyJumpTestForward(channel gossh.Channel, target net.Conn) {
	finished := make(chan struct{})
	go func() {
		_, _ = io.Copy(target, channel)
		_ = target.Close()
		_ = channel.Close()
		close(finished)
	}()
	_, _ = io.Copy(channel, target)
	_ = target.Close()
	_ = channel.Close()
	<-finished
}

func waitJumpSignal(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("SSH jump connection did not stop")
	}
}
