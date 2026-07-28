package netproxy

import (
	"context"
	"fmt"
	"net"
	"time"
)

const proxyDialTimeout = 30 * time.Second

var lookupProxyIPAddr = func(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

type safeDirectDialer struct{}

func (safeDirectDialer) Dial(network, address string) (net.Conn, error) {
	return secureDialContext(context.Background(), network, address)
}

func (safeDirectDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return secureDialContext(ctx, network, address)
}

func secureDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if ctx == nil {
		return nil, fmt.Errorf("dial context is required")
	}
	if !isSupportedDialNetwork(network) {
		return nil, fmt.Errorf("unsupported dial network %q", network)
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid dial address: %w", err)
	}
	host = normalizeHost(host)
	if host == "" {
		return nil, fmt.Errorf("dial host is required")
	}
	if isBlockedProxyHost(host) {
		return nil, fmt.Errorf("dial host is not allowed")
	}

	dialer := &net.Dialer{Timeout: proxyDialTimeout, KeepAlive: proxyDialTimeout}
	if ip := net.ParseIP(host); ip != nil {
		return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
	}

	addrs, err := lookupProxyIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	var lastErr error
	for _, addr := range addrs {
		if isBlockedProxyIP(addr.IP) {
			lastErr = fmt.Errorf("dial IP is not allowed")
			continue
		}
		conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(addr.IP.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no usable addresses for %s", host)
	}
	return nil, lastErr
}

func isSupportedDialNetwork(network string) bool {
	switch network {
	case "tcp", "tcp4", "tcp6":
		return true
	default:
		return false
	}
}

func normalizeHost(host string) string {
	for len(host) > 1 && host[len(host)-1] == '.' {
		host = host[:len(host)-1]
	}
	return host
}

func isBlockedProxyIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 169 && ip4[1] == 254 {
		return true
	}
	return false
}
