package testutil

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
)

type jumpServer struct {
	listener net.Listener
	target   string
	config   *gossh.ServerConfig
	ctx      context.Context
	cancel   context.CancelFunc
	mutex    sync.Mutex
	closed   bool
	active   map[net.Conn]struct{}
	workers  sync.WaitGroup
	stopOnce sync.Once
}

// NewJumpServer 将所有 direct-tcpip 请求转发至 targetAddress，以便测试仅跳板可解析的域名。
// 支持重复连接；stop 关闭监听器、已有 SSH 连接及转发，并等待生命周期任务退出。
func NewJumpServer(t *testing.T, targetAddress string) (string, func()) {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromKey(privateKey)
	require.NoError(t, err)
	config := &gossh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	server := &jumpServer{
		listener: listener, target: targetAddress, config: config,
		ctx: ctx, cancel: cancel, active: make(map[net.Conn]struct{}),
	}
	server.workers.Add(1)
	go server.serve()
	t.Cleanup(server.stop)
	return listener.Addr().String(), server.stop
}

func (s *jumpServer) serve() {
	defer s.workers.Done()
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			return
		}
		s.mutex.Lock()
		if s.closed {
			s.mutex.Unlock()
			_ = conn.Close()
			return
		}
		s.active[conn] = struct{}{}
		s.workers.Add(1)
		s.mutex.Unlock()
		go s.handle(conn)
	}
}

func (s *jumpServer) stop() {
	s.stopOnce.Do(func() {
		s.cancel()
		_ = s.listener.Close()
		s.mutex.Lock()
		s.closed = true
		for conn := range s.active {
			_ = conn.Close()
		}
		s.mutex.Unlock()
		s.workers.Wait()
	})
}

func (s *jumpServer) handle(conn net.Conn) {
	defer s.workers.Done()
	defer func() {
		_ = conn.Close()
		s.mutex.Lock()
		delete(s.active, conn)
		s.mutex.Unlock()
	}()
	_, channels, requests, err := gossh.NewServerConn(conn, s.config)
	if err != nil {
		return
	}
	go gossh.DiscardRequests(requests)
	for channel := range channels {
		s.workers.Add(1)
		go s.forward(channel)
	}
}

func (s *jumpServer) forward(channel gossh.NewChannel) {
	defer s.workers.Done()
	if channel.ChannelType() != "direct-tcpip" {
		_ = channel.Reject(gossh.UnknownChannelType, "unsupported")
		return
	}
	dialer := &net.Dialer{Timeout: time.Second}
	target, err := dialer.DialContext(s.ctx, "tcp", s.target)
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
	copyJumpForward(forwarded, target)
}

func copyJumpForward(channel gossh.Channel, target net.Conn) {
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
