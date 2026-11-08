package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func (a *AboutService) fetchLatestRelease(ctx context.Context, currentVersion, platform, arch string, requireArtifact bool) (*availableRelease, error) {
	release, err := a.fetchRelease(ctx, a.latestAPIURL)
	if err != nil {
		return nil, err
	}
	result, err := a.evaluateRelease(ctx, release, currentVersion, platform, arch, requireArtifact)
	if err == nil {
		return result, nil
	}
	if !requireArtifact || !errors.Is(err, errUpdateAssetNotFound) {
		return nil, err
	}
	return a.fetchFallbackRelease(ctx, currentVersion, platform, arch, release.TagName)
}

func (a *AboutService) fetchFallbackRelease(ctx context.Context, currentVersion, platform, arch, excludedTag string) (*availableRelease, error) {
	releases, err := a.fetchReleases(ctx)
	if err != nil {
		return nil, fmt.Errorf("list releases: %w", err)
	}
	var best *githubReleaseResponse
	for index := range releases {
		release := releases[index]
		if strings.EqualFold(release.TagName, excludedTag) || !downloadableUpdate(release, currentVersion, platform, arch) {
			continue
		}
		if best == nil {
			best = &release
			continue
		}
		comparison, err := compareVersions(release.TagName, best.TagName)
		if err == nil && comparison > 0 {
			best = &release
		}
	}
	if best == nil {
		return nil, fmt.Errorf("%w: no downloadable release newer than %s", errUpdateAssetNotFound, currentVersion)
	}
	return a.evaluateRelease(ctx, *best, currentVersion, platform, arch, true)
}

func downloadableUpdate(release githubReleaseResponse, currentVersion, platform, arch string) bool {
	available, err := isUpdateAvailable(release.TagName, currentVersion, release.PublishedAt)
	if err != nil || !available {
		return false
	}
	if _, err := trustedReleaseURL(release.HTMLURL, release.TagName); err != nil {
		return false
	}
	_, err = updateAsset(release, platform, arch)
	return err == nil
}

func (a *AboutService) fetchReleases(ctx context.Context) ([]githubReleaseResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, a.releasesAPIURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "mssh/"+Version)
	response, err := sameOriginHTTPClient(a.client, request.URL).Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub returned %s", response.Status)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxUpdateResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(content) > maxUpdateResponseBytes {
		return nil, fmt.Errorf("response exceeds %d bytes", maxUpdateResponseBytes)
	}
	var releases []githubReleaseResponse
	if err := json.Unmarshal(content, &releases); err != nil {
		return nil, err
	}
	return releases, nil
}
