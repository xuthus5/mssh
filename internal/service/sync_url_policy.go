package service

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// requireHTTPSUnlessLoopback enforces TLS for cloud endpoints while allowing local dev over loopback HTTP.
// Also rejects URL credentials and blocked metadata / link-local hosts.
func requireHTTPSUnlessLoopback(parsed *url.URL) error {
	if parsed == nil {
		return fmt.Errorf("URL is required")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("URL must use https (or http for loopback only)")
	}
	if parsed.User != nil {
		return fmt.Errorf("URL must not include credentials")
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return fmt.Errorf("URL host is required")
	}
	if isBlockedSyncHost(host) {
		return fmt.Errorf("URL host is not allowed")
	}
	if scheme == "https" {
		return nil
	}
	if isLoopbackHost(host) {
		return nil
	}
	return fmt.Errorf("URL must use https for non-loopback hosts")
}

func isBlockedSyncHost(host string) bool {
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

// validateS3Endpoint checks optional custom S3-compatible endpoints.
// Empty endpoint means AWS default (SDK-managed) and is allowed.
func validateS3Endpoint(endpoint string) error {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return nil
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("S3 endpoint URL is invalid")
	}
	return requireHTTPSUnlessLoopback(parsed)
}
