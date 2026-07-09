package testutil

import (
	"crypto/rand"
	"crypto/rsa"
	"net"
	"testing"

	gossh "golang.org/x/crypto/ssh"
)

type mockServerConfig struct {
	rejectPty   bool
	rejectShell bool
}

func NewMockServer(t *testing.T) (string, func()) {
	t.Helper()
	return newMockServerWithConfig(t, false, false)
}

func NewMockServerRejectPty(t *testing.T) (string, func()) {
	t.Helper()
	return newMockServerWithConfig(t, true, false)
}

func NewMockServerRejectShell(t *testing.T) (string, func()) {
	t.Helper()
	return newMockServerWithConfig(t, false, true)
}

func newMockServerWithConfig(t *testing.T, rejectPty, rejectShell bool) (string, func()) {
	t.Helper()
	config := &gossh.ServerConfig{
		NoClientAuth: true,
	}
	privateKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	signer, _ := gossh.NewSignerFromSigner(privateKey)
	config.AddHostKey(signer)
	listener, _ := net.Listen("tcp", "127.0.0.1:0")
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				_, chans, reqs, _ := gossh.NewServerConn(conn, config)
				go gossh.DiscardRequests(reqs)
				for ch := range chans {
					if ch.ChannelType() == "session" {
						channel, requests, _ := ch.Accept()
						go func() {
							for req := range requests {
								switch req.Type {
								case "shell":
									if rejectShell {
										_ = req.Reply(false, nil)
									} else {
										_ = req.Reply(true, nil)
										_, _ = channel.Write([]byte("mock> "))
									}
								case "pty-req":
									if rejectPty {
										_ = req.Reply(false, nil)
									} else {
										_ = req.Reply(true, nil)
									}
								default:
									_ = req.Reply(false, nil)
								}
							}
						}()
					}
				}
			}(conn)
		}
	}()
	return listener.Addr().String(), func() { _ = listener.Close() }
}
