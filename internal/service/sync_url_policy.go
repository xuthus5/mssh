package service

import (
	"fmt"
	"net/url"
	"strings"
)

// requireHTTPSUnlessLoopback enforces TLS for cloud endpoints while allowing local dev over loopback HTTP.
func requireHTTPSUnlessLoopback(parsed *url.URL) error {
	if parsed == nil {
		return fmt.Errorf("URL is required")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme == "https" {
		return nil
	}
	if scheme != "http" {
		return fmt.Errorf("URL must use https (or http for loopback only)")
	}
	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("URL host is required")
	}
	if isLoopbackHost(host) {
		return nil
	}
	return fmt.Errorf("URL must use https for non-loopback hosts")
}
