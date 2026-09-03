package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
)

func (g *gistSyncProvider) gistRawHTTPClient() *http.Client {
	client := *g.client
	baseRedirect := g.client.CheckRedirect
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if baseRedirect != nil {
			if err := baseRedirect(request, via); err != nil {
				return err
			}
		}
		_, includeCredential, err := validateGistRawURL(request.URL.String(), g.apiBase)
		if err != nil {
			return err
		}
		if !includeCredential {
			request.Header.Del("Authorization")
		}
		return nil
	}
	return &client
}

func (g *gistSyncProvider) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	return g.doWithHeaders(ctx, method, path, body, nil)
}

func (g *gistSyncProvider) doWithHeaders(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, g.apiBase+path, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Authorization", "Bearer "+g.token)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := sameOriginHTTPClient(g.client, request.URL).Do(request)
	if err != nil {
		return nil, fmt.Errorf("GitHub Gist request: %w", err)
	}
	return response, nil
}
