//go:build windows

package service

import (
	"context"
	"fmt"
	"net"

	"github.com/Microsoft/go-winio"
)

func dialAgentEndpoint(ctx context.Context, network, address string) (net.Conn, error) {
	if network != "npipe" {
		return nil, fmt.Errorf("unsupported SSH agent network %q", network)
	}
	return winio.DialPipeContext(ctx, address)
}
