package testutil

import (
	"crypto/rand"
	"crypto/rsa"
	"net"
	"testing"

	gossh "golang.org/x/crypto/ssh"
)

func NewMockServer(t *testing.T) (string, func()) {
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
			_, chans, reqs, _ := gossh.NewServerConn(conn, config)
			go gossh.DiscardRequests(reqs)
			for ch := range chans {
				if ch.ChannelType() == "session" {
					channel, requests, _ := ch.Accept()
					go func() {
						for req := range requests {
							switch req.Type {
							case "shell":
								req.Reply(true, nil)
								channel.Write([]byte("mock> "))
							case "pty-req":
								req.Reply(true, nil)
							default:
								req.Reply(false, nil)
							}
						}
					}()
				}
			}
		}
	}()
	return listener.Addr().String(), func() { listener.Close() }
}
