//go:build !windows

package service

import (
	"context"
	"net"
)

func dialAgentEndpoint(ctx context.Context, network, address string) (net.Conn, error) {
	return (&net.Dialer{}).DialContext(ctx, network, address)
}
