package service

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
)

type s3RedirectPolicy struct {
	origin       *url.URL
	baseRedirect func(*http.Request, []*http.Request) error
}

func s3HTTPClient(client *http.Client, endpoint string) (*http.Client, error) {
	var origin *url.URL
	if strings.TrimSpace(endpoint) != "" {
		parsed, err := url.ParseRequestURI(strings.TrimSpace(endpoint))
		if err != nil {
			return nil, errors.New("S3 endpoint URL is invalid")
		}
		origin = parsed
	}
	cloned := *client
	policy := s3RedirectPolicy{origin: origin, baseRedirect: client.CheckRedirect}
	cloned.CheckRedirect = policy.check
	return &cloned, nil
}

func (policy s3RedirectPolicy) check(request *http.Request, via []*http.Request) error {
	if err := secureHTTPRedirect(request, via); err != nil {
		return err
	}
	if request.Response == nil {
		return errors.New("S3 redirect response is required")
	}
	if request.Response.StatusCode != http.StatusTemporaryRedirect && request.Response.StatusCode != http.StatusPermanentRedirect {
		return http.ErrUseLastResponse
	}
	if policy.origin != nil && !sameHTTPOrigin(policy.origin, request.URL) {
		return errors.New("S3 redirect to a different origin is not allowed")
	}
	if len(via) > 0 && !sameHTTPOrigin(via[len(via)-1].URL, request.URL) {
		request.Header.Del("X-Amz-Security-Token")
	}
	if policy.baseRedirect != nil {
		return policy.baseRedirect(request, via)
	}
	return nil
}
