package ssh

import (
	"context"
	"net"

	gossh "golang.org/x/crypto/ssh"
)

func newClientWrapper(inner *gossh.Client, transport net.Conn) *ClientWrapper {
	keepAliveCtx, cancel := context.WithCancel(context.Background())
	wrapper := &ClientWrapper{
		Inner: inner, transport: transport, keepAliveCtx: keepAliveCtx,
		keepAliveCancel: cancel, done: make(chan struct{}),
	}
	if inner != nil {
		wrapper.connectionWG.Add(1)
		go wrapper.monitorConnection()
	}
	return wrapper
}

func (c *ClientWrapper) monitorConnection() {
	defer c.connectionWG.Done()
	_ = c.Inner.Wait()
	c.signalDone()
}

func (c *ClientWrapper) signalDone() {
	if c == nil {
		return
	}
	if c.keepAliveCancel != nil {
		c.keepAliveCancel()
	}
	if c.done != nil {
		c.doneOnce.Do(func() { close(c.done) })
	}
}

// Done closes when the SSH transport ends or the wrapper is closed.
func (c *ClientWrapper) Done() <-chan struct{} {
	if c == nil {
		return nil
	}
	return c.done
}
