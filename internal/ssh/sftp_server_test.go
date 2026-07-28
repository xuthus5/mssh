package ssh

import (
	"crypto/rand"
	"crypto/rsa"
	"net"
	"testing"

	"github.com/pkg/sftp"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
)

func startSFTPServerWithHandlers(t *testing.T, handlers sftp.Handlers) (string, func()) {
	t.Helper()
	config := &gossh.ServerConfig{NoClientAuth: true}
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromSigner(privateKey)
	require.NoError(t, err)
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	go serveSFTPConnections(listener, config, handlers)
	return listener.Addr().String(), func() { _ = listener.Close() }
}

func serveSFTPConnections(listener net.Listener, config *gossh.ServerConfig, handlers sftp.Handlers) {
	for {
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		go serveSFTPConnection(connection, config, handlers)
	}
}

func serveSFTPConnection(connection net.Conn, config *gossh.ServerConfig, handlers sftp.Handlers) {
	serverConnection, channels, requests, err := gossh.NewServerConn(connection, config)
	if err != nil {
		_ = connection.Close()
		return
	}
	go gossh.DiscardRequests(requests)
	for channelRequest := range channels {
		if channelRequest.ChannelType() != "session" {
			_ = channelRequest.Reject(gossh.UnknownChannelType, "unknown channel type")
			continue
		}
		channel, channelRequests, acceptErr := channelRequest.Accept()
		if acceptErr != nil {
			break
		}
		go replySFTPSubsystem(channelRequests)
		server := sftp.NewRequestServer(channel, handlers)
		_ = server.Serve()
		_ = server.Close()
	}
	_ = serverConnection.Close()
}

func replySFTPSubsystem(requests <-chan *gossh.Request) {
	for request := range requests {
		accepted := request.Type == "subsystem" && len(request.Payload) > 4 && string(request.Payload[4:]) == "sftp"
		_ = request.Reply(accepted, nil)
	}
}
