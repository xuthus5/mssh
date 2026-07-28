package ssh

import (
	"context"
	"fmt"
	"io"
	"net"
	"strconv"
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
	managed := startTunnelListener(ln, func(ctx context.Context, conn net.Conn) {
		remote, err := dialTunnelTargetContext(ctx, cw.Inner, remoteAddr, tunnelConnectTimeout)
		if err != nil {
			return
		}
		copyBidirectionalContext(ctx, conn, remote)
	}, onExit)
	managed.closeOnDone(cw.Done())
	return managed, nil
}

func StartRemoteForward(cw *ClientWrapper, remoteAddr, localAddr string, onExit func()) (net.Listener, error) {
	ln, err := cw.Inner.Listen("tcp", remoteAddr)
	if err != nil {
		return nil, fmt.Errorf("remote forward listen: %w", err)
	}
	managed := startTunnelListener(ln, func(ctx context.Context, conn net.Conn) {
		local, err := dialTunnelTargetContext(ctx, &net.Dialer{}, localAddr, tunnelConnectTimeout)
		if err != nil {
			return
		}
		copyBidirectionalContext(ctx, conn, local)
	}, onExit)
	managed.closeOnDone(cw.Done())
	return managed, nil
}

func StartDynamicForward(cw *ClientWrapper, localAddr string, onExit func()) (net.Listener, error) {
	ln, err := net.Listen("tcp", localAddr)
	if err != nil {
		return nil, fmt.Errorf("dynamic forward listen: %w", err)
	}
	managed := startTunnelListener(ln, func(ctx context.Context, conn net.Conn) {
		handleSOCKS5Context(ctx, cw, conn)
	}, onExit)
	managed.closeOnDone(cw.Done())
	return managed, nil
}

func copyBidirectional(a, b io.ReadWriteCloser) {
	copyBidirectionalContext(context.Background(), a, b)
}

func copyBidirectionalContext(ctx context.Context, a, b io.ReadWriteCloser) {
	results := make(chan error, 2)
	go copyTunnelDirection(b, a, results)
	go copyTunnelDirection(a, b, results)
	var done <-chan struct{}
	if ctx != nil {
		done = ctx.Done()
	}
	for remaining := 2; remaining > 0; {
		select {
		case copyErr := <-results:
			remaining--
			if copyErr != nil {
				closeTunnelConnections(a, b)
			}
		case <-done:
			closeTunnelConnections(a, b)
			done = nil
		}
	}
	closeTunnelConnections(a, b)
}

func closeTunnelConnections(a, b io.Closer) {
	_ = a.Close()
	_ = b.Close()
}

func copyTunnelDirection(destination, source io.ReadWriteCloser, results chan<- error) {
	_, err := io.Copy(destination, source)
	if err == nil {
		err = closeTunnelWrite(destination)
	}
	results <- err
}

func closeTunnelWrite(connection io.ReadWriteCloser) error {
	writer, ok := connection.(interface{ CloseWrite() error })
	if !ok {
		return fmt.Errorf("tunnel connection does not support half-close")
	}
	return writer.CloseWrite()
}
