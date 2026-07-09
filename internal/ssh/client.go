package ssh

import (
	"context"
	"fmt"
	"net"

	gossh "golang.org/x/crypto/ssh"

	"mssh/internal/model"
)

type ClientWrapper struct {
	Inner           *gossh.Client
	keepAliveCtx    context.Context
	keepAliveCancel context.CancelFunc
}

func Connect(ctx context.Context, s model.Session, auth []gossh.AuthMethod) (*ClientWrapper, error) {
	config := &gossh.ClientConfig{
		User:            s.Username,
		Auth:            auth,
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
	}
	addr := fmt.Sprintf("%s:%d", s.Host, s.Port)
	dialer := &net.Dialer{Timeout: 10 * 1e9}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", addr, err)
	}
	sshConn, chans, reqs, err := gossh.NewClientConn(conn, addr, config)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("ssh handshake: %w", err)
	}
	client := gossh.NewClient(sshConn, chans, reqs)
	kc, cancel := context.WithCancel(context.Background())
	return &ClientWrapper{Inner: client, keepAliveCtx: kc, keepAliveCancel: cancel}, nil
}

func (c *ClientWrapper) Close() error {
	c.keepAliveCancel()
	return c.Inner.Close()
}
