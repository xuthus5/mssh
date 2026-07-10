package ssh

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"mssh/internal/model"
	"mssh/internal/ssh/testutil"
)

func startEchoServer(t *testing.T) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				buf := make([]byte, 4096)
				for {
					n, err := conn.Read(buf)
					if n > 0 {
						_, _ = conn.Write(buf[:n])
					}
					if err != nil {
						break
					}
				}
			}()
		}
	}()
	return ln.Addr().String(), func() { _ = ln.Close() }
}

func newSSHServer(t *testing.T, handler func(destAddr string, channel gossh.Channel, requests <-chan *gossh.Request)) (string, func()) {
	t.Helper()
	config := &gossh.ServerConfig{
		NoClientAuth: true,
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromSigner(key)
	require.NoError(t, err)
	config.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				sconn, chans, reqs, err := gossh.NewServerConn(conn, config)
				if err != nil {
					return
				}
				go gossh.DiscardRequests(reqs)
				for ch := range chans {
					switch ch.ChannelType() {
					case "session":
						channel, requests, err := ch.Accept()
						if err != nil {
							continue
						}
						go gossh.DiscardRequests(requests)
						_ = channel.Close()
					case "direct-tcpip":
						if handler == nil {
							_ = ch.Reject(gossh.ConnectionFailed, "not supported")
							continue
						}
						channel, requests, err := ch.Accept()
						if err != nil {
							continue
						}
						dest := parseDirectTCPIPDest(ch.ExtraData())
						go gossh.DiscardRequests(requests)
						handler(dest, channel, requests)
					default:
						_ = ch.Reject(gossh.UnknownChannelType, "unknown")
					}
				}
				_ = sconn.Close()
			}()
		}
	}()

	return ln.Addr().String(), func() { _ = ln.Close() }
}

func newRemoteCapableSSHServer(t *testing.T) (string, func()) {
	t.Helper()
	config := &gossh.ServerConfig{
		NoClientAuth: true,
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromSigner(key)
	require.NoError(t, err)
	config.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				sconn, chans, reqs, err := gossh.NewServerConn(conn, config)
				if err != nil {
					return
				}
				defer sconn.Close()

				var fwdListeners []net.Listener
				var fwdMu sync.Mutex

				go func() {
					for req := range reqs {
						switch req.Type {
						case "tcpip-forward":
							var p struct {
								Addr string
								Port uint32
							}
							_ = gossh.Unmarshal(req.Payload, &p)
							fwdAddr := fmt.Sprintf("%s:%d", p.Addr, p.Port)
							fwdLn, lErr := net.Listen("tcp", fwdAddr)
							if lErr != nil {
								_ = req.Reply(false, nil)
								continue
							}
							fwdMu.Lock()
							fwdListeners = append(fwdListeners, fwdLn)
							fwdMu.Unlock()

							boundPort := uint32(parsePort(fwdLn.Addr().String()))
							replyPayload := gossh.Marshal(&struct{ Port uint32 }{Port: boundPort})
							_ = req.Reply(true, replyPayload)

							go func() {
								defer fwdLn.Close()
								for {
									fwdConn, aErr := fwdLn.Accept()
									if aErr != nil {
										return
									}
									originHost, originPortStr, _ := net.SplitHostPort(fwdConn.RemoteAddr().String())
									originPort, _ := strconv.Atoi(originPortStr)

									chData := gossh.Marshal(&struct {
										Addr       string
										Port       uint32
										OriginAddr string
										OriginPort uint32
									}{
										Addr:       p.Addr,
										Port:       boundPort,
										OriginAddr: originHost,
										OriginPort: uint32(originPort),
									})
									ch, chReqs, chErr := sconn.OpenChannel("forwarded-tcpip", chData)
									if chErr != nil {
										_ = fwdConn.Close()
										continue
									}
									go gossh.DiscardRequests(chReqs)
									go func() {
										defer ch.Close()
										defer fwdConn.Close()
										var wg sync.WaitGroup
										wg.Add(2)
										go func() { defer wg.Done(); _, _ = io.Copy(ch, fwdConn) }()
										go func() { defer wg.Done(); _, _ = io.Copy(fwdConn, ch) }()
										wg.Wait()
									}()
								}
							}()
						case "cancel-tcpip-forward":
							_ = req.Reply(true, nil)
						default:
							_ = req.Reply(false, nil)
						}
					}
				}()

				for ch := range chans {
					switch ch.ChannelType() {
					case "session":
						channel, requests, cErr := ch.Accept()
						if cErr != nil {
							continue
						}
						go gossh.DiscardRequests(requests)
						_ = channel.Close()
					case "direct-tcpip":
						channel, requests, cErr := ch.Accept()
						if cErr != nil {
							continue
						}
						go gossh.DiscardRequests(requests)
						dest := parseDirectTCPIPDest(ch.ExtraData())
						go func() {
							defer channel.Close()
							destConn, dErr := net.Dial("tcp", dest)
							if dErr != nil {
								return
							}
							defer destConn.Close()
							var wg sync.WaitGroup
							wg.Add(2)
							go func() { defer wg.Done(); _, _ = io.Copy(channel, destConn) }()
							go func() { defer wg.Done(); _, _ = io.Copy(destConn, channel) }()
							wg.Wait()
						}()
					default:
						_ = ch.Reject(gossh.UnknownChannelType, "unknown")
					}
				}

				fwdMu.Lock()
				for _, l := range fwdListeners {
					_ = l.Close()
				}
				fwdMu.Unlock()
			}()
		}
	}()

	return ln.Addr().String(), func() { _ = ln.Close() }
}

func parseDirectTCPIPDest(data []byte) string {
	var msg struct {
		DestAddr   string
		DestPort   uint32
		SourceAddr string
		SourcePort uint32
	}
	_ = gossh.Unmarshal(data, &msg)
	return fmt.Sprintf("%s:%d", msg.DestAddr, msg.DestPort)
}

func parsePort(addr string) int {
	_, portStr, _ := strings.Cut(addr, ":")
	port, _ := strconv.Atoi(portStr)
	return port
}

func connectToSSH(t *testing.T, addr string) *ClientWrapper {
	t.Helper()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, "", slog.Default())
	require.NoError(t, err)
	t.Cleanup(func() { cw.Close() })
	return cw
}

func forwardHandlerToEcho(destAddr string, channel gossh.Channel, _ <-chan *gossh.Request) {
	defer channel.Close()
	destConn, err := net.Dial("tcp", destAddr)
	if err != nil {
		return
	}
	defer destConn.Close()
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _, _ = io.Copy(channel, destConn) }()
	go func() { defer wg.Done(); _, _ = io.Copy(destConn, channel) }()
	wg.Wait()
}

func echoData(t *testing.T, addr string, data string) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	require.NoError(t, err)
	defer conn.Close()
	sendAndExpect(t, conn, data, data)
}

func sendAndExpect(t *testing.T, conn net.Conn, send string, expect string) {
	t.Helper()
	_, err := conn.Write([]byte(send))
	require.NoError(t, err)
	buf := make([]byte, len(expect)+64)
	n, err := io.ReadFull(conn, buf[:len(expect)])
	require.NoError(t, err)
	assert.Equal(t, expect, string(buf[:n]))
}

func sendSOCKS5Connect(t *testing.T, conn net.Conn, host string, port int) {
	t.Helper()
	err := socks5Handshake(conn)
	require.NoError(t, err)

	ip := net.ParseIP(host).To4()
	require.NotNil(t, ip)
	req := []byte{0x05, 0x01, 0x00, 0x01}
	req = append(req, ip...)
	req = append(req, byte(port>>8), byte(port&0xFF))
	_, err = conn.Write(req)
	require.NoError(t, err)

	resp := make([]byte, 10)
	_, err = io.ReadFull(conn, resp)
	require.NoError(t, err)
	assert.Equal(t, byte(0x05), resp[0])
	assert.Equal(t, byte(0x00), resp[1])
}

func sendSOCKS5ConnectFail(t *testing.T, conn net.Conn, host string, port int) {
	t.Helper()
	err := socks5Handshake(conn)
	require.NoError(t, err)

	ip := net.ParseIP(host).To4()
	require.NotNil(t, ip)
	req := []byte{0x05, 0x01, 0x00, 0x01}
	req = append(req, ip...)
	req = append(req, byte(port>>8), byte(port&0xFF))
	_, err = conn.Write(req)
	require.NoError(t, err)

	resp := make([]byte, 10)
	_, err = io.ReadFull(conn, resp)
	require.NoError(t, err)
	assert.Equal(t, byte(0x05), resp[0])
	assert.Equal(t, byte(0x05), resp[1])
}

func socks5Handshake(conn net.Conn) error {
	_, err := conn.Write([]byte{0x05, 0x01, 0x00})
	if err != nil {
		return err
	}
	resp := make([]byte, 2)
	_, err = io.ReadFull(conn, resp)
	if err != nil {
		return err
	}
	return nil
}

func sendSOCKS5ConnectDomain(t *testing.T, conn net.Conn, host string, port int) {
	t.Helper()
	_ = socks5Handshake(conn)

	req := []byte{0x05, 0x01, 0x00, 0x03, byte(len(host))}
	req = append(req, []byte(host)...)
	req = append(req, byte(port>>8), byte(port&0xFF))
	_, err := conn.Write(req)
	require.NoError(t, err)

	buf := make([]byte, 10)
	_, err = io.ReadFull(conn, buf)
	require.NoError(t, err)
}

func sendSOCKS5ConnectIPv6(t *testing.T, conn net.Conn, host string, port int) {
	t.Helper()
	_ = socks5Handshake(conn)

	ip := net.ParseIP(host).To16()
	require.NotNil(t, ip)
	req := []byte{0x05, 0x01, 0x00, 0x04}
	req = append(req, ip...)
	req = append(req, byte(port>>8), byte(port&0xFF))
	_, err := conn.Write(req)
	require.NoError(t, err)

	buf := make([]byte, 10)
	_, _ = io.ReadFull(conn, buf)
}

func TestStartLocalForward(t *testing.T) {
	echoAddr, echoCleanup := startEchoServer(t)
	defer echoCleanup()

	sshAddr, sshCleanup := newSSHServer(t, forwardHandlerToEcho)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	remoteAddr := fmt.Sprintf("127.0.0.1:%d", parsePort(echoAddr))
	ln, err := StartLocalForward(cw, "127.0.0.1:0", remoteAddr)
	require.NoError(t, err)
	defer ln.Close()

	echoData(t, ln.Addr().String(), "hello-local-forward")
}

func TestStartLocalForward_ClosedWrapper(t *testing.T) {
	sshAddr, sshCleanup := newSSHServer(t, nil)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	ln, err := StartLocalForward(cw, "127.0.0.1:0", "127.0.0.1:9999")
	require.NoError(t, err)
	cw.Close()

	conn, err := net.DialTimeout("tcp", ln.Addr().String(), 500*time.Millisecond)
	require.NoError(t, err)
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	buf := make([]byte, 64)
	_, err = conn.Read(buf)
	assert.Error(t, err)
	_ = ln.Close()
}

func TestStartLocalForward_RemoteUnreachable(t *testing.T) {
	sshAddr, sshCleanup := newSSHServer(t, func(destAddr string, channel gossh.Channel, _ <-chan *gossh.Request) {
		defer channel.Close()
		_, _ = net.Dial("tcp", destAddr)
	})
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	ln, err := StartLocalForward(cw, "127.0.0.1:0", "127.0.0.1:1")
	require.NoError(t, err)
	defer ln.Close()

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	buf := make([]byte, 64)
	_, err = conn.Read(buf)
	assert.Error(t, err)
	_ = conn.Close()
}

func TestStartRemoteForward(t *testing.T) {
	echoAddr, echoCleanup := startEchoServer(t)
	defer echoCleanup()

	sshAddr, sshCleanup := newRemoteCapableSSHServer(t)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	localAddr := fmt.Sprintf("127.0.0.1:%d", parsePort(echoAddr))
	ln, err := StartRemoteForward(cw, "127.0.0.1:0", localAddr)
	require.NoError(t, err)
	defer ln.Close()

	echoData(t, ln.Addr().String(), "hello-remote-forward")
}

func TestStartRemoteForward_ClosedWrapper(t *testing.T) {
	sshAddr, sshCleanup := newRemoteCapableSSHServer(t)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	cw.Close()

	_, err := StartRemoteForward(cw, "127.0.0.1:0", "127.0.0.1:9999")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "remote forward listen")
}

func TestStartRemoteForward_LocalUnreachable(t *testing.T) {
	sshAddr, sshCleanup := newRemoteCapableSSHServer(t)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	ln, err := StartRemoteForward(cw, "127.0.0.1:0", "127.0.0.1:1")
	require.NoError(t, err)
	defer ln.Close()

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	buf := make([]byte, 64)
	_, err = conn.Read(buf)
	assert.Error(t, err)
	_ = conn.Close()
}

func TestStartDynamicForward(t *testing.T) {
	echoAddr, echoCleanup := startEchoServer(t)
	defer echoCleanup()

	sshAddr, sshCleanup := newRemoteCapableSSHServer(t)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	ln, err := StartDynamicForward(cw, "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	defer conn.Close()

	sendSOCKS5Connect(t, conn, "127.0.0.1", parsePort(echoAddr))
	sendAndExpect(t, conn, "hello-socks5", "hello-socks5")
}

func TestStartDynamicForward_IPv6(t *testing.T) {
	sshAddr, sshCleanup := newSSHServer(t, nil)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	ln, err := StartDynamicForward(cw, "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	defer conn.Close()

	sendSOCKS5ConnectIPv6(t, conn, "::1", 9999)
	buf := make([]byte, 16)
	_, _ = conn.Read(buf)
}

func TestStartDynamicForward_DomainName(t *testing.T) {
	echoAddr, echoCleanup := startEchoServer(t)
	defer echoCleanup()

	sshAddr, sshCleanup := newRemoteCapableSSHServer(t)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	ln, err := StartDynamicForward(cw, "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	defer conn.Close()

	sendSOCKS5ConnectDomain(t, conn, "127.0.0.1", parsePort(echoAddr))
	sendAndExpect(t, conn, "hello-domain", "hello-domain")
}

func TestStartDynamicForward_ClosedWrapper(t *testing.T) {
	sshAddr, sshCleanup := newSSHServer(t, nil)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	ln, err := StartDynamicForward(cw, "127.0.0.1:0")
	require.NoError(t, err)
	cw.Close()

	conn, err := net.DialTimeout("tcp", ln.Addr().String(), 500*time.Millisecond)
	require.NoError(t, err)
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	buf := make([]byte, 64)
	_, err = conn.Read(buf)
	assert.Error(t, err)
	_ = ln.Close()
}

func TestStartDynamicForward_UnsupportedAddressType(t *testing.T) {
	sshAddr, sshCleanup := newSSHServer(t, nil)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	ln, err := StartDynamicForward(cw, "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	defer conn.Close()

	_, _ = conn.Write([]byte{0x05, 0x01, 0x00})
	readFullIgnoreErr(conn, make([]byte, 2))

	_, _ = conn.Write([]byte{0x05, 0x01, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})
	resp := make([]byte, 10)
	readFullIgnoreErr(conn, resp)
	assert.Equal(t, byte(0x05), resp[0])
	assert.Equal(t, byte(0x08), resp[1])
}

func TestStartDynamicForward_UnreachableTarget(t *testing.T) {
	sshAddr, sshCleanup := newSSHServer(t, nil)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	ln, err := StartDynamicForward(cw, "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	defer conn.Close()

	sendSOCKS5ConnectFail(t, conn, "127.0.0.1", 9999)
}

func TestStartForward_Local(t *testing.T) {
	echoAddr, echoCleanup := startEchoServer(t)
	defer echoCleanup()

	sshAddr, sshCleanup := newSSHServer(t, forwardHandlerToEcho)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	cfg := ForwardConfig{
		Type:       model.TunnelLocal,
		LocalHost:  "127.0.0.1",
		LocalPort:  0,
		RemoteHost: "127.0.0.1",
		RemotePort: parsePort(echoAddr),
	}

	raw, stop, err := StartForward(cw, cfg)
	require.NoError(t, err)
	defer stop()

	ln, ok := raw.(net.Listener)
	require.True(t, ok)
	echoData(t, ln.Addr().String(), "hello-from-startforward-local")
}

func TestStartForward_Remote(t *testing.T) {
	echoAddr, echoCleanup := startEchoServer(t)
	defer echoCleanup()

	sshAddr, sshCleanup := newRemoteCapableSSHServer(t)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	cfg := ForwardConfig{
		Type:       model.TunnelRemote,
		LocalHost:  "127.0.0.1",
		LocalPort:  parsePort(echoAddr),
		RemoteHost: "127.0.0.1",
		RemotePort: 0,
	}

	raw, stop, err := StartForward(cw, cfg)
	require.NoError(t, err)
	defer stop()

	ln, ok := raw.(net.Listener)
	require.True(t, ok)
	echoData(t, ln.Addr().String(), "hello-from-startforward-remote")
}

func TestStartForward_Dynamic(t *testing.T) {
	echoAddr, echoCleanup := startEchoServer(t)
	defer echoCleanup()

	sshAddr, sshCleanup := newRemoteCapableSSHServer(t)
	defer sshCleanup()

	cw := connectToSSH(t, sshAddr)
	cfg := ForwardConfig{
		Type:      model.TunnelDynamic,
		LocalHost: "127.0.0.1",
		LocalPort: 0,
	}

	raw, stop, err := StartForward(cw, cfg)
	require.NoError(t, err)
	defer stop()

	ln, ok := raw.(net.Listener)
	require.True(t, ok)

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	defer conn.Close()

	sendSOCKS5Connect(t, conn, "127.0.0.1", parsePort(echoAddr))
	sendAndExpect(t, conn, "hello-dynamic-unified", "hello-dynamic-unified")
}

func TestStartForward_UnknownType(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()

	cw := connectToSSH(t, addr)
	cfg := ForwardConfig{
		Type: model.TunnelType("invalid"),
	}

	_, _, err := StartForward(cw, cfg)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown tunnel type")
}

func TestSOCKS5_BadProtocolVersion(t *testing.T) {
	t.Run("wrong version", func(t *testing.T) {
		sshAddr, sshCleanup := newSSHServer(t, nil)
		defer sshCleanup()
		cw := connectToSSH(t, sshAddr)
		ln, err := StartDynamicForward(cw, "127.0.0.1:0")
		require.NoError(t, err)
		defer ln.Close()

		conn, err := net.Dial("tcp", ln.Addr().String())
		require.NoError(t, err)
		_, _ = conn.Write([]byte{0x04, 0x01, 0x00})
		time.Sleep(100 * time.Millisecond)
		_ = conn.Close()
	})

	t.Run("wrong cmd", func(t *testing.T) {
		sshAddr, sshCleanup := newSSHServer(t, nil)
		defer sshCleanup()
		cw := connectToSSH(t, sshAddr)
		ln, err := StartDynamicForward(cw, "127.0.0.1:0")
		require.NoError(t, err)
		defer ln.Close()

		conn, err := net.Dial("tcp", ln.Addr().String())
		require.NoError(t, err)
		_, _ = conn.Write([]byte{0x05, 0x01, 0x00, 0x05, 0x02, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00})
		time.Sleep(100 * time.Millisecond)
		_ = conn.Close()
	})

	t.Run("conn closed before write", func(t *testing.T) {
		sshAddr, sshCleanup := newSSHServer(t, nil)
		defer sshCleanup()
		cw := connectToSSH(t, sshAddr)
		ln, err := StartDynamicForward(cw, "127.0.0.1:0")
		require.NoError(t, err)
		defer ln.Close()

		conn, _ := net.Dial("tcp", ln.Addr().String())
		_ = conn.Close()
		time.Sleep(100 * time.Millisecond)
	})
}

func readFullIgnoreErr(conn net.Conn, buf []byte) {
	_, _ = io.ReadFull(conn, buf)
}
