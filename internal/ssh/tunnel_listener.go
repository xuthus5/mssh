package ssh

import (
	"context"
	"net"
	"sync"
)

type tunnelConnectionHandler func(context.Context, net.Conn)

type tunnelListener struct {
	listener net.Listener
	ctx      context.Context
	cancel   context.CancelFunc
	gate     tunnelConnGate

	mu          sync.Mutex
	closing     bool
	connections map[*tunnelConnection]struct{}
	handlers    sync.WaitGroup

	closeOnce sync.Once
	closeErr  error
	done      chan struct{}
}

func startTunnelListener(
	listener net.Listener,
	handle tunnelConnectionHandler,
	onExit func(),
) *tunnelListener {
	ctx, cancel := context.WithCancel(context.Background())
	managed := &tunnelListener{
		listener:    listener,
		ctx:         ctx,
		cancel:      cancel,
		connections: make(map[*tunnelConnection]struct{}),
		done:        make(chan struct{}),
	}
	go managed.serve(handle, onExit)
	return managed
}

func (l *tunnelListener) Accept() (net.Conn, error) {
	connection, err := l.listener.Accept()
	if err != nil {
		return nil, err
	}
	tracked := &tunnelConnection{Conn: connection, owner: l}
	l.mu.Lock()
	if l.closing {
		l.mu.Unlock()
		_ = tracked.Close()
		return nil, net.ErrClosed
	}
	l.connections[tracked] = struct{}{}
	l.mu.Unlock()
	return tracked, nil
}

func (l *tunnelListener) Close() error {
	l.initiateClose()
	<-l.done
	return l.closeErr
}

func (l *tunnelListener) Addr() net.Addr {
	return l.listener.Addr()
}

func (l *tunnelListener) closeOnDone(done <-chan struct{}) {
	if done == nil {
		return
	}
	go func() {
		select {
		case <-done:
			l.initiateClose()
		case <-l.done:
		}
	}()
}

func (l *tunnelListener) serve(handle tunnelConnectionHandler, onExit func()) {
	for {
		connection, err := l.Accept()
		if err != nil {
			break
		}
		if !l.dispatch(connection, handle) {
			break
		}
	}
	l.initiateClose()
	l.handlers.Wait()
	close(l.done)
	if onExit != nil {
		onExit()
	}
}

func (l *tunnelListener) dispatch(connection net.Conn, handle tunnelConnectionHandler) bool {
	if !l.gate.tryAcquire() {
		_ = connection.Close()
		return true
	}
	l.mu.Lock()
	if l.closing {
		l.mu.Unlock()
		l.gate.release()
		_ = connection.Close()
		return false
	}
	l.handlers.Add(1)
	l.mu.Unlock()
	go l.handleConnection(connection, handle)
	return true
}

func (l *tunnelListener) handleConnection(connection net.Conn, handle tunnelConnectionHandler) {
	defer l.handlers.Done()
	defer l.gate.release()
	defer func() { _ = connection.Close() }()
	handle(l.ctx, connection)
}

func (l *tunnelListener) initiateClose() {
	l.closeOnce.Do(func() {
		connections := l.markClosing()
		l.cancel()
		l.closeErr = l.listener.Close()
		for _, connection := range connections {
			_ = connection.Close()
		}
	})
}

func (l *tunnelListener) markClosing() []*tunnelConnection {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closing = true
	connections := make([]*tunnelConnection, 0, len(l.connections))
	for connection := range l.connections {
		connections = append(connections, connection)
	}
	return connections
}

func (l *tunnelListener) removeConnection(connection *tunnelConnection) {
	l.mu.Lock()
	delete(l.connections, connection)
	l.mu.Unlock()
}

type tunnelConnection struct {
	net.Conn
	owner     *tunnelListener
	closeOnce sync.Once
	closeErr  error
}

func (c *tunnelConnection) Close() error {
	c.closeOnce.Do(func() {
		c.closeErr = c.Conn.Close()
		c.owner.removeConnection(c)
	})
	return c.closeErr
}

func (c *tunnelConnection) CloseWrite() error {
	return closeTunnelWrite(c.Conn)
}
