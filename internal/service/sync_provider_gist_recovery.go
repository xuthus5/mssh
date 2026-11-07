package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

func (g *gistSyncProvider) testToken(ctx context.Context) error {
	response, err := g.do(ctx, http.MethodGet, "/user", nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	return expectHTTPStatus(response, http.StatusOK, "GitHub Gist connection")
}

func (g *gistSyncProvider) testConfiguredGist(ctx context.Context) error {
	response, err := g.do(ctx, http.MethodGet, "/gists/"+url.PathEscape(g.gistID), nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return nil
	}
	if response.StatusCode != http.StatusOK {
		return gistAPIError(response, "GitHub Gist connection")
	}
	return nil
}

func (g *gistSyncProvider) prepareConfiguredGistForPut(ctx context.Context, etag string) error {
	if strings.TrimSpace(etag) != "" {
		err := g.ensureGistETag(ctx, etag)
		if errors.Is(err, errSyncRemoteNotFound) {
			g.gistID = ""
			return nil
		}
		return err
	}
	return g.adoptOrCreateConfiguredGist(ctx)
}

func (g *gistSyncProvider) adoptOrCreateConfiguredGist(ctx context.Context) error {
	response, err := g.do(ctx, http.MethodGet, "/gists/"+url.PathEscape(g.gistID), nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		g.gistID = ""
		return nil
	}
	if response.StatusCode != http.StatusOK {
		return gistAPIError(response, "fetch GitHub Gist")
	}
	var gist gistResponse
	if err := decodeBoundedJSON(response.Body, maxCloudBackupSize, &gist); err != nil {
		return fmt.Errorf("decode GitHub Gist: %w", err)
	}
	if _, exists := gist.Files[syncBackupFileName]; exists {
		return errSyncConflict
	}
	return nil
}
