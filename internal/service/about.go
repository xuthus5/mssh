package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
)

const (
	RepositoryURL          = "https://github.com/xuthus5/mssh"
	latestAPIURL           = "https://api.github.com/repos/xuthus5/mssh/releases/latest"
	maxUpdateResponseBytes = 1 << 20
)

var Version = "0.1.0"

type AboutService struct {
	client       *http.Client
	latestAPIURL string
	lifecycle    aboutServiceLifecycle
}

type githubReleaseResponse struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

func NewAboutService(proxy ...*netproxy.Manager) *AboutService {
	client := sharedHTTPClient(10*time.Second, firstProxy(proxy...))
	return &AboutService{client: client, latestAPIURL: latestAPIURL}
}

func (a *AboutService) Info() model.AboutInfo {
	return model.AboutInfo{CurrentVersion: Version, RepositoryURL: RepositoryURL}
}

func (a *AboutService) CheckUpdate(ctx context.Context) (*model.UpdateInfo, error) {
	operationContext, finish, err := a.beginOperation(ctx)
	if err != nil {
		return nil, fmt.Errorf("check update: %w", err)
	}
	defer finish()
	request, err := http.NewRequestWithContext(operationContext, http.MethodGet, a.latestAPIURL, nil)
	if err != nil {
		return nil, fmt.Errorf("check update: create request: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "mssh/"+Version)
	response, err := sameOriginHTTPClient(a.client, request.URL).Do(request)
	if err != nil {
		return nil, fmt.Errorf("check update: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("check update: GitHub returned %s", response.Status)
	}
	release, err := decodeUpdateRelease(response.Body)
	if err != nil {
		return nil, fmt.Errorf("check update: decode response: %w", err)
	}
	if strings.TrimSpace(release.TagName) == "" {
		return nil, fmt.Errorf("check update: latest release has no version")
	}
	comparison, err := compareVersions(release.TagName, Version)
	if err != nil {
		return nil, fmt.Errorf("check update: compare versions: %w", err)
	}
	releaseURL, err := trustedReleaseURL(release.HTMLURL, release.TagName)
	if err != nil {
		return nil, fmt.Errorf("check update: %w", err)
	}
	return &model.UpdateInfo{CurrentVersion: Version, LatestVersion: release.TagName, ReleaseURL: releaseURL, UpdateAvailable: comparison > 0}, nil
}

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

type semanticVersion struct {
	core       [3]uint64
	prerelease []string
}

func compareVersions(left, right string) (int, error) {
	leftVersion, err := parseSemanticVersion(left)
	if err != nil {
		return 0, fmt.Errorf("invalid version %q: %w", left, err)
	}
	rightVersion, err := parseSemanticVersion(right)
	if err != nil {
		return 0, fmt.Errorf("invalid version %q: %w", right, err)
	}
	for index := range leftVersion.core {
		if leftVersion.core[index] > rightVersion.core[index] {
			return 1, nil
		}
		if leftVersion.core[index] < rightVersion.core[index] {
			return -1, nil
		}
	}
	return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease), nil
}

func parseSemanticVersion(value string) (semanticVersion, error) {
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	versionPart, build, hasBuild := strings.Cut(value, "+")
	if hasBuild {
		if _, err := parseVersionIdentifiers(build, false); err != nil {
			return semanticVersion{}, fmt.Errorf("invalid build metadata: %w", err)
		}
	}
	corePart, prerelease, hasPrerelease := strings.Cut(versionPart, "-")
	coreValues := strings.Split(corePart, ".")
	if len(coreValues) != 3 {
		return semanticVersion{}, fmt.Errorf("version core must contain major.minor.patch")
	}
	parsed := semanticVersion{}
	for index, component := range coreValues {
		if component == "" || (len(component) > 1 && component[0] == '0') {
			return semanticVersion{}, fmt.Errorf("invalid numeric component %q", component)
		}
		number, err := strconv.ParseUint(component, 10, 64)
		if err != nil {
			return semanticVersion{}, fmt.Errorf("invalid numeric component %q", component)
		}
		parsed.core[index] = number
	}
	if hasPrerelease {
		identifiers, err := parseVersionIdentifiers(prerelease, true)
		if err != nil {
			return semanticVersion{}, fmt.Errorf("invalid prerelease: %w", err)
		}
		parsed.prerelease = identifiers
	}
	return parsed, nil
}

func parseVersionIdentifiers(value string, rejectLeadingZero bool) ([]string, error) {
	identifiers := strings.Split(value, ".")
	for _, identifier := range identifiers {
		if identifier == "" {
			return nil, fmt.Errorf("identifier is empty")
		}
		for _, character := range identifier {
			if !isVersionIdentifierCharacter(character) {
				return nil, fmt.Errorf("identifier %q contains invalid characters", identifier)
			}
		}
		if rejectLeadingZero && isDecimalIdentifier(identifier) && len(identifier) > 1 && identifier[0] == '0' {
			return nil, fmt.Errorf("numeric identifier %q has a leading zero", identifier)
		}
	}
	return identifiers, nil
}

func comparePrerelease(left, right []string) int {
	if len(left) == 0 && len(right) == 0 {
		return 0
	}
	if len(left) == 0 {
		return 1
	}
	if len(right) == 0 {
		return -1
	}
	for index := 0; index < min(len(left), len(right)); index++ {
		if compared := compareVersionIdentifier(left[index], right[index]); compared != 0 {
			return compared
		}
	}
	return compareInt(len(left), len(right))
}

func compareVersionIdentifier(left, right string) int {
	leftNumeric, rightNumeric := isDecimalIdentifier(left), isDecimalIdentifier(right)
	if leftNumeric && rightNumeric {
		if len(left) != len(right) {
			return compareInt(len(left), len(right))
		}
		return strings.Compare(left, right)
	}
	if leftNumeric {
		return -1
	}
	if rightNumeric {
		return 1
	}
	return strings.Compare(left, right)
}

func compareInt(left, right int) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func isDecimalIdentifier(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return value != ""
}

func isVersionIdentifierCharacter(character rune) bool {
	return character == '-' || character >= '0' && character <= '9' ||
		character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z'
}

func trustedReleaseURL(rawURL, tag string) (string, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil {
		return "", fmt.Errorf("latest release URL is not trusted")
	}
	expectedPath := "/xuthus5/mssh/releases/tag/" + tag
	if parsed.Path != expectedPath || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("latest release URL does not match version %s", tag)
	}
	return parsed.String(), nil
}
