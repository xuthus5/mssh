package testutil

import (
	"crypto/rand"
	"crypto/rsa"
	"net"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
)

// NewMockServerIgnoringGlobalRequests starts a controllable SSH server that
// consumes global requests without replying to them.
func NewMockServerIgnoringGlobalRequests(t *testing.T) (string, func(), func()) {
	t.Helper()
	config := &gossh.ServerConfig{NoClientAuth: true}
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromSigner(privateKey)
	require.NoError(t, err)
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	var mutex sync.Mutex
	connections := make(map[net.Conn]struct{})
	disconnect := func() {
		mutex.Lock()
		active := make([]net.Conn, 0, len(connections))
		for connection := range connections {
			active = append(active, connection)
		}
		mutex.Unlock()
		for _, connection := range active {
			_ = connection.Close()
		}
	}
	go serveControlledSSH(listener, config, &mutex, connections)
	stop := func() {
		_ = listener.Close()
		disconnect()
	}
	return listener.Addr().String(), disconnect, stop
}

func serveControlledSSH(
	listener net.Listener,
	config *gossh.ServerConfig,
	mutex *sync.Mutex,
	connections map[net.Conn]struct{},
) {
	for {
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		mutex.Lock()
		connections[connection] = struct{}{}
		mutex.Unlock()
		go handleControlledSSHConnection(connection, config, mutex, connections)
	}
}

func handleControlledSSHConnection(
	connection net.Conn,
	config *gossh.ServerConfig,
	mutex *sync.Mutex,
	connections map[net.Conn]struct{},
) {
	defer func() {
		_ = connection.Close()
		mutex.Lock()
		delete(connections, connection)
		mutex.Unlock()
	}()
	_, channels, requests, err := gossh.NewServerConn(connection, config)
	if err != nil {
		return
	}
	go func() {
		for range requests {
		}
	}()
	for channel := range channels {
		_ = channel.Reject(gossh.UnknownChannelType, "unsupported")
	}
}
