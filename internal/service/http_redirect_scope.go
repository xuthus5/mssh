package service

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
)

func sameOriginHTTPClient(client *http.Client, origin *url.URL) *http.Client {
	cloned := *client
	baseRedirect := client.CheckRedirect
	cloned.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if err := secureHTTPRedirect(request, via); err != nil {
			return err
		}
		if !sameHTTPOrigin(origin, request.URL) {
			return errors.New("redirect to a different origin is not allowed")
		}
		if request.Response == nil {
			return errors.New("redirect response is required")
		}
		if request.Response.StatusCode != http.StatusTemporaryRedirect && request.Response.StatusCode != http.StatusPermanentRedirect {
			return http.ErrUseLastResponse
		}
		if baseRedirect != nil {
			return baseRedirect(request, via)
		}
		return nil
	}
	return &cloned
}

func sameHTTPOrigin(left, right *url.URL) bool {
	if left == nil || right == nil {
		return false
	}
	return strings.EqualFold(left.Scheme, right.Scheme) &&
		strings.EqualFold(left.Hostname(), right.Hostname()) &&
		effectiveHTTPPort(left) == effectiveHTTPPort(right)
}

func effectiveHTTPPort(endpoint *url.URL) string {
	if port := endpoint.Port(); port != "" {
		return port
	}
	if strings.EqualFold(endpoint.Scheme, "http") {
		return "80"
	}
	if strings.EqualFold(endpoint.Scheme, "https") {
		return "443"
	}
	return ""
}
