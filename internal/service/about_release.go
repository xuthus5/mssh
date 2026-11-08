package service

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

type githubReleaseResponse struct {
	TagName     string               `json:"tag_name"`
	HTMLURL     string               `json:"html_url"`
	PublishedAt string               `json:"published_at"`
	Assets      []githubReleaseAsset `json:"assets"`
}

type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	ContentType        string `json:"content_type"`
	Size               int64  `json:"size"`
}

type availableRelease struct {
	Info        model.UpdateInfo
	Tag         string
	PublishedAt time.Time
	Asset       githubReleaseAsset
	Digest      []byte
}

var errUpdateAssetNotFound = errors.New("update asset not found")

func decodeUpdateRelease(reader io.Reader) (githubReleaseResponse, error) {
	content, err := io.ReadAll(io.LimitReader(reader, maxUpdateResponseBytes+1))
	if err != nil {
		return githubReleaseResponse{}, err
	}
	if len(content) > maxUpdateResponseBytes {
		return githubReleaseResponse{}, fmt.Errorf("response exceeds %d bytes", maxUpdateResponseBytes)
	}
	var release githubReleaseResponse
	if err := json.Unmarshal(content, &release); err != nil {
		return githubReleaseResponse{}, err
	}
	return release, nil
}

func (a *AboutService) fetchRelease(ctx context.Context, apiURL string) (githubReleaseResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return githubReleaseResponse{}, fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "mssh/"+Version)
	response, err := sameOriginHTTPClient(a.client, request.URL).Do(request)
	if err != nil {
		return githubReleaseResponse{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return githubReleaseResponse{}, fmt.Errorf("GitHub returned %s", response.Status)
	}
	release, err := decodeUpdateRelease(response.Body)
	if err != nil {
		return githubReleaseResponse{}, fmt.Errorf("decode response: %w", err)
	}
	return release, nil
}

func (a *AboutService) evaluateRelease(ctx context.Context, release githubReleaseResponse, currentVersion, platform, arch string, requireArtifact bool) (*availableRelease, error) {
	if strings.TrimSpace(release.TagName) == "" {
		return nil, fmt.Errorf("latest release has no version")
	}
	updateAvailable, err := isUpdateAvailable(release.TagName, currentVersion, release.PublishedAt)
	if err != nil {
		return nil, fmt.Errorf("compare versions: %w", err)
	}
	releaseURL, err := trustedReleaseURL(release.HTMLURL, release.TagName)
	if err != nil {
		return nil, err
	}
	info := model.UpdateInfo{
		CurrentVersion: currentVersion, LatestVersion: release.TagName,
		ReleaseURL: releaseURL, UpdateAvailable: updateAvailable,
	}
	if !updateAvailable {
		return &availableRelease{Info: info}, nil
	}
	result := &availableRelease{
		Info: info, Tag: release.TagName, PublishedAt: releasePublishedAt(release.PublishedAt),
	}
	if !requireArtifact {
		return result, nil
	}
	asset, err := updateAsset(release, platform, arch)
	if err != nil {
		return nil, err
	}
	digest, err := a.fetchUpdateDigest(ctx, release, asset.Name)
	if err != nil {
		return nil, err
	}
	info.ArtifactName, info.ArtifactSize = asset.Name, asset.Size
	result.Info = info
	result.Asset = asset
	result.Digest = digest
	return result, nil
}

func releasePublishedAt(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func updateAsset(release githubReleaseResponse, platform, arch string) (githubReleaseAsset, error) {
	name := fmt.Sprintf("mssh-%s-%s-%s", strings.TrimPrefix(release.TagName, "v"), platform, arch)
	switch platform {
	case "windows":
		name += ".exe"
	case "darwin":
		name += ".app.zip"
	case "linux":
	default:
		return githubReleaseAsset{}, fmt.Errorf("automatic updates are not supported on %s", platform)
	}
	for _, asset := range release.Assets {
		if !strings.EqualFold(asset.Name, name) {
			continue
		}
		if _, err := trustedReleaseAssetURL(asset.BrowserDownloadURL, release.TagName, asset.Name); err != nil {
			return githubReleaseAsset{}, err
		}
		return asset, nil
	}
	return githubReleaseAsset{}, fmt.Errorf("%w: release %s has no update asset for %s/%s", errUpdateAssetNotFound, release.TagName, platform, arch)
}

func trustedReleaseAssetURL(rawURL, tag, name string) (string, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil {
		return "", fmt.Errorf("release asset URL is not trusted")
	}
	expectedPath := "/xuthus5/mssh/releases/download/" + tag + "/" + name
	if parsed.Path != expectedPath || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("release asset URL does not match %s", name)
	}
	return parsed.String(), nil
}

func (a *AboutService) fetchUpdateDigest(ctx context.Context, release githubReleaseResponse, target string) ([]byte, error) {
	checksumName := "mssh-" + strings.TrimPrefix(release.TagName, "v") + "-SHA256SUMS"
	for _, asset := range release.Assets {
		if !strings.EqualFold(asset.Name, checksumName) {
			continue
		}
		checksumURL, err := trustedReleaseAssetURL(asset.BrowserDownloadURL, release.TagName, asset.Name)
		if err != nil {
			return nil, err
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, checksumURL, nil)
		if err != nil {
			return nil, fmt.Errorf("create checksum request: %w", err)
		}
		response, err := a.client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("download checksum: %w", err)
		}
		defer func() { _ = response.Body.Close() }()
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("download checksum returned %s", response.Status)
		}
		content, err := io.ReadAll(io.LimitReader(response.Body, maxUpdateResponseBytes))
		if err != nil {
			return nil, fmt.Errorf("read checksum: %w", err)
		}
		return checksumDigest(string(content), target)
	}
	return nil, nil
}

func checksumDigest(content, target string) ([]byte, error) {
	for _, line := range strings.Split(content, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(strings.TrimPrefix(fields[len(fields)-1], "*"), "./")
		if name != target {
			continue
		}
		digest, err := hex.DecodeString(fields[0])
		if err != nil {
			return nil, fmt.Errorf("malformed checksum for %s: %w", target, err)
		}
		return digest, nil
	}
	return nil, fmt.Errorf("checksum for %s is missing", target)
}
