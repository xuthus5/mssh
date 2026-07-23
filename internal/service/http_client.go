package service

import (
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
// All clients share a CheckRedirect policy that blocks credentialed redirects and unsafe hosts.
func sharedHTTPClient(timeout time.Duration, manager *netproxy.Manager) *http.Client {
	var client *http.Client
	if manager == nil {
		client = &http.Client{Timeout: timeout}
	} else {
		client = manager.Client(timeout)
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
	if ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 169 && ip4[1] == 254 {
		return true
	}
	return false
}
