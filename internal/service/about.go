package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
)

const (
	RepositoryURL = "https://github.com/xuthus5/mssh"
	latestAPIURL  = "https://api.github.com/repos/xuthus5/mssh/releases/latest"
)

var Version = "0.1.0"

type AboutService struct {
	client       *http.Client
	latestAPIURL string
}

func NewAboutService(proxy ...*netproxy.Manager) *AboutService {
	client := sharedHTTPClient(10*time.Second, firstProxy(proxy...))
	return &AboutService{client: client, latestAPIURL: latestAPIURL}
}

func (a *AboutService) Info() model.AboutInfo {
	return model.AboutInfo{CurrentVersion: Version, RepositoryURL: RepositoryURL}
}

func (a *AboutService) CheckUpdate(ctx context.Context) (*model.UpdateInfo, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, a.latestAPIURL, nil)
	if err != nil {
		return nil, fmt.Errorf("check update: create request: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "mssh/"+Version)
	response, err := a.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("check update: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("check update: GitHub returned %s", response.Status)
	}
	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(response.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("check update: decode response: %w", err)
	}
	if strings.TrimSpace(release.TagName) == "" {
		return nil, fmt.Errorf("check update: latest release has no version")
	}
	return &model.UpdateInfo{CurrentVersion: Version, LatestVersion: release.TagName, ReleaseURL: release.HTMLURL, UpdateAvailable: compareVersions(release.TagName, Version) > 0}, nil
}

func compareVersions(left, right string) int {
	leftParts := versionParts(left)
	rightParts := versionParts(right)
	for index := range leftParts {
		if leftParts[index] > rightParts[index] {
			return 1
		}
		if leftParts[index] < rightParts[index] {
			return -1
		}
	}
	return 0
}

func versionParts(version string) [3]int {
	var result [3]int
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(version), "v"), ".")
	for index := 0; index < len(result) && index < len(parts); index++ {
		value := strings.SplitN(parts[index], "-", 2)[0]
		result[index], _ = strconv.Atoi(value)
	}
	return result
}
