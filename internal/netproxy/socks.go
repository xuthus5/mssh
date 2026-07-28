package netproxy

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"

	xproxy "golang.org/x/net/proxy"
)

func isSOCKSScheme(scheme string) bool {
	switch strings.ToLower(strings.TrimSpace(scheme)) {
	case "socks5", "socks5h":
		return true
	default:
		return false
	}
}

type configuredDialer struct {
	config Config
}

func (d configuredDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	config := Normalize(d.config)
	if config.Mode != ModeManual {
		return secureDialContext(ctx, network, address)
	}

	proxyURL, err := manualProxyURL(config)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy configuration: %w", err)
	}
	if !isSOCKSScheme(proxyURL.Scheme) {
		return secureDialContext(ctx, network, address)
	}
	if shouldBypassAddress(address, config.NoProxy) {
		return secureDialContext(ctx, network, address)
	}
	return dialSOCKSContext(ctx, network, address, proxyURL)
}

func dialSOCKSContext(ctx context.Context, network, address string, proxyURL *url.URL) (net.Conn, error) {
	if err := validateSOCKSTarget(network, address); err != nil {
		return nil, err
	}
	dialer, err := xproxy.FromURL(proxyURL, safeDirectDialer{})
	if err != nil {
		return nil, fmt.Errorf("create SOCKS proxy dialer: %w", err)
	}
	contextDialer, ok := dialer.(xproxy.ContextDialer)
	if !ok {
		return nil, fmt.Errorf("SOCKS proxy dialer does not support context")
	}
	return contextDialer.DialContext(ctx, network, address)
}

func validateSOCKSTarget(network, address string) error {
	if !isSupportedDialNetwork(network) {
		return fmt.Errorf("unsupported SOCKS target network %q", network)
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("invalid SOCKS target address: %w", err)
	}
	if host = normalizeHost(host); host == "" {
		return fmt.Errorf("SOCKS target host is required")
	}
	if isBlockedProxyHost(host) {
		return fmt.Errorf("SOCKS target host is not allowed")
	}
	return nil
}

func shouldBypassAddress(address, noProxy string) bool {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	target := &url.URL{Host: net.JoinHostPort(host, port)}
	return shouldBypass(target, noProxy)
}
