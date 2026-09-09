package ssh

import (
	"io"
	"net"
	"sync"
)

// jumpHostTransport 以本地管道为 SSH 转发通道补充 deadline，并拥有整条连接链。
type jumpHostTransport struct {
	net.Conn
	relay     net.Conn
	forwarded net.Conn
	jumpHost  *ClientWrapper
	workers   sync.WaitGroup
	closeOnce sync.Once
	closeErr  error
}

func newJumpHostTransport(forwarded net.Conn, jumpHost *ClientWrapper) *jumpHostTransport {
	client, relay := net.Pipe()
	transport := &jumpHostTransport{Conn: client, relay: relay, forwarded: forwarded, jumpHost: jumpHost}
	transport.workers.Add(2)
	go transport.copyForwarded(relay, forwarded)
	go transport.copyForwarded(forwarded, relay)
	return transport
}

func (c *jumpHostTransport) LocalAddr() net.Addr {
	return c.forwarded.LocalAddr()
}

func (c *jumpHostTransport) RemoteAddr() net.Addr {
	return c.forwarded.RemoteAddr()
}

func (c *jumpHostTransport) copyForwarded(destination, source net.Conn) {
	defer c.workers.Done()
	_, _ = io.Copy(destination, source)
	_ = c.closeTransport()
}

func (c *jumpHostTransport) closeTransport() error {
	c.closeOnce.Do(func() {
		_ = c.Conn.Close()
		_ = c.relay.Close()
		// 先关闭跳板底层连接，解除 SSH 通道关闭包或转发写入的阻塞。
		c.closeErr = c.jumpHost.closeConnection()
		_ = c.forwarded.Close()
	})
	return c.closeErr
}

func (c *jumpHostTransport) Close() error {
	err := c.closeTransport()
	c.workers.Wait()
	// 错误已由 closeTransport 保存；此处等待跳板自己的生命周期任务结束。
	_ = c.jumpHost.Close()
	return err
}
