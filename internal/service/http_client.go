package service

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/netproxy"
)

const maxHTTPRedirects = 5

// sharedHTTPClient builds an HTTP client. When manager is nil, system proxy is used via DefaultTransport.
// All clients share redirect and dial policies that block metadata/link-local targets and unsafe redirects.
func sharedHTTPClient(timeout time.Duration, manager *netproxy.Manager) *http.Client {
	var client *http.Client
	if manager == nil {
		client = &http.Client{Timeout: timeout, Transport: secureHTTPTransport(nil)}
	} else {
		client = manager.Client(timeout)
		client.Transport = secureHTTPTransport(client.Transport)
	}
	client.CheckRedirect = secureHTTPRedirect
	return client
}

func firstProxy(proxy ...*netproxy.Manager) *netproxy.Manager {
	if len(proxy) == 0 {
		return nil
	}
	return proxy[0]
}

func secureHTTPTransport(base http.RoundTripper) *http.Transport {
	var transport *http.Transport
	switch typed := base.(type) {
	case *http.Transport:
		transport = typed.Clone()
	case nil:
		if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok {
			transport = defaultTransport.Clone()
		} else {
			transport = &http.Transport{}
		}
	default:
		// Unknown RoundTripper: wrap with a fresh transport that still has proxy from environment.
		if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok {
			transport = defaultTransport.Clone()
		} else {
			transport = &http.Transport{}
		}
	}
	transport.DialContext = secureDialContext
	return transport
}

func secureDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid dial address: %w", err)
	}
	host = strings.Trim(host, "[]")
	if isBlockedOutboundHost(host) {
		return nil, fmt.Errorf("outbound dial host is not allowed")
	}

	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	// Literal IP: validate and dial directly.
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedOutboundIP(ip) {
			return nil, fmt.Errorf("outbound dial IP is not allowed")
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
	}

	// Hostname: resolve first, skip blocked answers, dial pinned IP (mitigates DNS rebinding to metadata).
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	var lastErr error
	for _, addr := range addrs {
		if isBlockedOutboundIP(addr.IP) {
			lastErr = fmt.Errorf("outbound dial IP is not allowed")
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

// secureHTTPRedirect rejects open-redirect SSRF patterns for application HTTP traffic
// (AI providers, cloud sync helpers, update checks).
func secureHTTPRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxHTTPRedirects {
		return fmt.Errorf("stopped after %d redirects", maxHTTPRedirects)
	}
	if req == nil || req.URL == nil {
		return fmt.Errorf("redirect URL is required")
	}
	if err := validateOutboundHTTPURL(req.URL.String()); err != nil {
		return err
	}
	// Do not forward Authorization / API keys across hosts on redirects.
	if len(via) > 0 && via[0] != nil && via[0].URL != nil {
		if !sameHTTPHost(via[0].URL.Host, req.URL.Host) {
			req.Header.Del("Authorization")
			req.Header.Del("X-Api-Key")
			req.Header.Del("x-api-key")
			req.Header.Del("X-Subscription-Token")
			req.Header.Del("X-API-KEY")
		}
	}
	return nil
}

func sameHTTPHost(left, right string) bool {
	return strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right))
}

// validateOutboundHTTPURL enforces scheme/host policy for outbound application HTTP.
func validateOutboundHTTPURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("invalid outbound URL")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("outbound URL must use HTTP or HTTPS")
	}
	if parsed.User != nil {
		return fmt.Errorf("outbound URL must not include credentials")
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return fmt.Errorf("invalid outbound URL host")
	}
	if isBlockedOutboundHost(host) {
		return fmt.Errorf("outbound URL host is not allowed")
	}
	// HTTPS required unless host is loopback (local dev / ollama / test servers).
	if scheme != "https" && !isLoopbackHost(host) {
		return fmt.Errorf("outbound URL must use HTTPS for non-loopback hosts")
	}
	return nil
}

func isBlockedOutboundHost(host string) bool {
	normalized := strings.Trim(strings.ToLower(strings.TrimSpace(host)), "[]")
	if _, blocked := blockedAIProviderHostnames[normalized]; blocked {
		return true
	}
	ip := net.ParseIP(normalized)
	if ip == nil {
		return false
	}
	return isBlockedOutboundIP(ip)
}

func isBlockedOutboundIP(ip net.IP) bool {
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
