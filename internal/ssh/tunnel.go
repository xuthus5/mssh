package ssh

import (
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/xuthus5/mssh/internal/model"
)

// maxTunnelForwardConns limits simultaneous accepted forward connections per listener.
const maxTunnelForwardConns = 256

type tunnelConnGate struct {
	active atomic.Int64
}

func (g *tunnelConnGate) tryAcquire() bool {
	for {
		current := g.active.Load()
		if current >= maxTunnelForwardConns {
			return false
		}
		if g.active.CompareAndSwap(current, current+1) {
			return true
		}
	}
}

func (g *tunnelConnGate) release() {
	g.active.Add(-1)
}

type ForwardConfig struct {
	Type       model.TunnelType
	LocalHost  string
	LocalPort  int
	RemoteHost string
	RemotePort int
	// OnAcceptExit is invoked once when the accept loop ends (listener closed or accept error).
	OnAcceptExit func()
}

func StartForward(cw *ClientWrapper, cfg ForwardConfig) (interface{}, func() error, error) {
	switch cfg.Type {
	case model.TunnelLocal:
		localAddr := net.JoinHostPort(cfg.LocalHost, strconv.Itoa(cfg.LocalPort))
		remoteAddr := net.JoinHostPort(cfg.RemoteHost, strconv.Itoa(cfg.RemotePort))
		ln, err := StartLocalForward(cw, localAddr, remoteAddr, cfg.OnAcceptExit)
		if err != nil {
			return nil, nil, err
		}
		return ln, ln.Close, nil
	case model.TunnelRemote:
		remoteAddr := net.JoinHostPort(cfg.RemoteHost, strconv.Itoa(cfg.RemotePort))
		localAddr := net.JoinHostPort(cfg.LocalHost, strconv.Itoa(cfg.LocalPort))
		ln, err := StartRemoteForward(cw, remoteAddr, localAddr, cfg.OnAcceptExit)
		if err != nil {
			return nil, nil, err
		}
		return ln, ln.Close, nil
	case model.TunnelDynamic:
		localAddr := net.JoinHostPort(cfg.LocalHost, strconv.Itoa(cfg.LocalPort))
		ln, err := StartDynamicForward(cw, localAddr, cfg.OnAcceptExit)
		if err != nil {
			return nil, nil, err
		}
		return ln, ln.Close, nil
	default:
		return nil, nil, fmt.Errorf("unknown tunnel type: %s", cfg.Type)
	}
}

func StartLocalForward(cw *ClientWrapper, localAddr, remoteAddr string, onExit func()) (net.Listener, error) {
	ln, err := net.Listen("tcp", localAddr)
	if err != nil {
		return nil, fmt.Errorf("local forward listen: %w", err)
	}
	gate := &tunnelConnGate{}
	go acceptForwardLoop(ln, gate, func(conn net.Conn) {
		defer func() { _ = conn.Close() }()
		remote, err := cw.Inner.Dial("tcp", remoteAddr)
		if err != nil {
			return
		}
		copyBidirectional(conn, remote)
	}, onExit)
	return ln, nil
}

func StartRemoteForward(cw *ClientWrapper, remoteAddr, localAddr string, onExit func()) (net.Listener, error) {
	ln, err := cw.Inner.Listen("tcp", remoteAddr)
	if err != nil {
		return nil, fmt.Errorf("remote forward listen: %w", err)
	}
	gate := &tunnelConnGate{}
	go acceptForwardLoop(ln, gate, func(conn net.Conn) {
		defer func() { _ = conn.Close() }()
		local, err := net.Dial("tcp", localAddr)
		if err != nil {
			return
		}
		copyBidirectional(conn, local)
	}, onExit)
	return ln, nil
}

func StartDynamicForward(cw *ClientWrapper, localAddr string, onExit func()) (net.Listener, error) {
	ln, err := net.Listen("tcp", localAddr)
	if err != nil {
		return nil, fmt.Errorf("dynamic forward listen: %w", err)
	}
	gate := &tunnelConnGate{}
	go acceptForwardLoop(ln, gate, func(conn net.Conn) {
		handleSOCKS5(cw, conn)
	}, onExit)
	return ln, nil
}

func acceptForwardLoop(ln net.Listener, gate *tunnelConnGate, handle func(net.Conn), onExit func()) {
	defer func() {
		if onExit != nil {
			onExit()
		}
	}()
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		if !gate.tryAcquire() {
			_ = conn.Close()
			continue
		}
		go func(c net.Conn) {
			defer gate.release()
			handle(c)
		}(conn)
	}
}

func copyBidirectional(a, b net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(b, a)
		_ = b.Close()
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(a, b)
		_ = a.Close()
	}()
	wg.Wait()
}

func handleSOCKS5(cw *ClientWrapper, conn net.Conn) {
	defer func() { _ = conn.Close() }()
	dest, ok := readSOCKS5Destination(conn)
	if !ok {
		return
	}
	remote, err := cw.Inner.Dial("tcp", dest)
	if err != nil {
		_, _ = conn.Write([]byte{0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})
		return
	}
	defer func() { _ = remote.Close() }()
	if _, err = conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}); err != nil {
		return
	}
	copyBidirectional(conn, remote)
}

func readSOCKS5Destination(conn net.Conn) (string, bool) {
	buf := make([]byte, 263)
	n, err := io.ReadFull(conn, buf[:2])
	if err != nil || n < 2 || buf[0] != 0x05 {
		return "", false
	}
	nm := int(buf[1])
	if _, err = io.ReadFull(conn, buf[:nm]); err != nil {
		return "", false
	}
	if _, err = conn.Write([]byte{0x05, 0x00}); err != nil {
		return "", false
	}
	n, err = io.ReadFull(conn, buf[:4])
	if err != nil || n < 4 || buf[0] != 0x05 || buf[1] != 0x01 {
		return "", false
	}
	switch buf[3] {
	case 0x01:
		if _, err = io.ReadFull(conn, buf[:4+2]); err != nil {
			return "", false
		}
		return fmt.Sprintf("%d.%d.%d.%d:%d", buf[0], buf[1], buf[2], buf[3], int(buf[4])<<8|int(buf[5])), true
	case 0x03:
		if _, err = io.ReadFull(conn, buf[:1]); err != nil {
			return "", false
		}
		domainLen := int(buf[0])
		if _, err = io.ReadFull(conn, buf[:domainLen+2]); err != nil {
			return "", false
		}
		return fmt.Sprintf("%s:%d", string(buf[:domainLen]), int(buf[domainLen])<<8|int(buf[domainLen+1])), true
	case 0x04:
		if _, err = io.ReadFull(conn, buf[:16+2]); err != nil {
			return "", false
		}
		ip := net.IP(buf[:16])
		return fmt.Sprintf("[%s]:%d", ip.String(), int(buf[16])<<8|int(buf[17])), true
	default:
		_, _ = conn.Write([]byte{0x05, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})
		return "", false
	}
}
