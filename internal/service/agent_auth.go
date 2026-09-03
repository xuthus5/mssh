package service

import (
	"context"
	"fmt"
	"net"
	"os"
	"time"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

const sshAgentOperationTimeout = 10 * time.Second

type agentSocketDialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

// agentAuth holds an open SSH agent socket for the full authentication handshake.
type agentAuth struct {
	sock        net.Conn
	signers     []gossh.Signer
	stopContext func() bool
}

func (a *agentAuth) Close() {
	if a == nil {
		return
	}
	if a.stopContext != nil {
		_ = a.stopContext()
		a.stopContext = nil
	}
	if a.sock == nil {
		return
	}
	_ = a.sock.Close()
	a.sock = nil
}

type agentDeadlineConn struct {
	net.Conn
	timeout time.Duration
}

func (c *agentDeadlineConn) Read(buffer []byte) (int, error) {
	if err := c.SetReadDeadline(time.Now().Add(c.timeout)); err != nil {
		return 0, fmt.Errorf("set SSH agent read deadline: %w", err)
	}
	return c.Conn.Read(buffer)
}

func (c *agentDeadlineConn) Write(buffer []byte) (int, error) {
	if err := c.SetWriteDeadline(time.Now().Add(c.timeout)); err != nil {
		return 0, fmt.Errorf("set SSH agent write deadline: %w", err)
	}
	return c.Conn.Write(buffer)
}

func openAgentAuth() (*agentAuth, error) {
	return openAgentAuthContext(context.Background())
}

func openAgentAuthContext(ctx context.Context) (*agentAuth, error) {
	return openAgentAuthAt(ctx, os.Getenv("SSH_AUTH_SOCK"), sshAgentOperationTimeout, platformAgentDialer{})
}

type platformAgentDialer struct{}

func (platformAgentDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return dialAgentEndpoint(ctx, network, address)
}

func openAgentAuthAt(
	ctx context.Context,
	socketPath string,
	timeout time.Duration,
	dialer agentSocketDialer,
) (*agentAuth, error) {
	if ctx == nil {
		return nil, fmt.Errorf("ssh agent context is required")
	}
	if timeout <= 0 {
		return nil, fmt.Errorf("ssh agent timeout must be positive")
	}
	if dialer == nil {
		return nil, fmt.Errorf("ssh agent dialer is required")
	}
	network, address, err := resolveSSHAgentEndpoint(socketPath)
	if err != nil {
		return nil, fmt.Errorf("ssh agent endpoint: %w", err)
	}
	dialCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	sock, err := dialer.DialContext(dialCtx, network, address)
	if err != nil {
		return nil, fmt.Errorf("ssh agent dial: %w", err)
	}
	boundedConn := &agentDeadlineConn{Conn: sock, timeout: timeout}
	stopContext := context.AfterFunc(ctx, func() { _ = boundedConn.Close() })
	agentClient := agent.NewClient(boundedConn)
	signers, err := agentClient.Signers()
	if err != nil {
		closeAgentConnection(boundedConn, stopContext)
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, fmt.Errorf("ssh agent request: %w", contextErr)
		}
		return nil, fmt.Errorf("ssh agent signers: %w", err)
	}
	if len(signers) == 0 {
		closeAgentConnection(boundedConn, stopContext)
		return nil, fmt.Errorf("ssh agent: no signers available")
	}
	if contextErr := ctx.Err(); contextErr != nil {
		closeAgentConnection(boundedConn, stopContext)
		return nil, fmt.Errorf("ssh agent request: %w", contextErr)
	}
	return &agentAuth{sock: boundedConn, signers: signers, stopContext: stopContext}, nil
}

func closeAgentConnection(conn net.Conn, stopContext func() bool) {
	if stopContext != nil {
		_ = stopContext()
	}
	_ = conn.Close()
}
