package testutil

import (
	"crypto/rand"
	"crypto/rsa"
	"net"
	"path/filepath"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// KnownHostsPath returns a writable known_hosts path under t.TempDir for tests.
func KnownHostsPath(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "known_hosts")
}

func NewMockServer(t *testing.T) (string, func()) {
	t.Helper()
	return newMockServerWithConfig(t, false, false, false, false)
}

func NewMockServerRejectPty(t *testing.T) (string, func()) {
	t.Helper()
	return newMockServerWithConfig(t, true, false, false, false)
}

func NewMockServerRejectShell(t *testing.T) (string, func()) {
	t.Helper()
	return newMockServerWithConfig(t, false, true, false, false)
}

func NewMockServerAutoLogout(t *testing.T) (string, func()) {
	t.Helper()
	return newMockServerWithConfig(t, false, false, true, false)
}

func NewMockServerImmediateLogout(t *testing.T) (string, func()) {
	t.Helper()
	return newMockServerWithConfig(t, false, false, true, true)
}

func newMockServerWithConfig(t *testing.T, rejectPty, rejectShell, autoLogout, immediateLogout bool) (string, func()) {
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
										if autoLogout {
											_, _ = channel.Write([]byte("time out waiting for input: auto-logout\r\n"))
											if !immediateLogout {
												time.Sleep(10 * time.Millisecond)
											}
											_ = channel.Close()
										}
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
