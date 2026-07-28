package ssh

import (
	"context"
	"fmt"
	"net"
	"time"
)

const tunnelConnectTimeout = 10 * time.Second

type contextDialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

func dialTunnelTarget(dialer contextDialer, address string, timeout time.Duration) (net.Conn, error) {
	return dialTunnelTargetContext(context.Background(), dialer, address, timeout)
}

func dialTunnelTargetContext(parent context.Context, dialer contextDialer, address string, timeout time.Duration) (net.Conn, error) {
	if parent == nil {
		return nil, fmt.Errorf("tunnel dial context is required")
	}
	if dialer == nil {
		return nil, fmt.Errorf("tunnel dialer is required")
	}
	if timeout <= 0 {
		return nil, fmt.Errorf("tunnel dial timeout must be positive")
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	return dialer.DialContext(ctx, "tcp", address)
}
