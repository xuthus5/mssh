package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
)

const (
	RepositoryURL          = "https://github.com/xuthus5/mssh"
	latestAPIURL           = "https://api.github.com/repos/xuthus5/mssh/releases/latest"
	releasesAPIURL         = "https://api.github.com/repos/xuthus5/mssh/releases?per_page=20"
	maxUpdateResponseBytes = 1 << 20
)

var Version = "0.1.0"

type AboutService struct {
	client           *http.Client
	downloadClient   *http.Client
	latestAPIURL     string
	releasesAPIURL   string
	logger           *slog.Logger
	autoUpdateSource autoUpdateSettingSource
	updater          updateEngine
	autoUpdateEvery  time.Duration
	autoUpdateWake   chan struct{}
	autoUpdateOnce   sync.Once
	readyMu          sync.Mutex
	readyUpdate      *model.UpdateInfo
	readyHandler     func(model.UpdateInfo)
	lifecycle        aboutServiceLifecycle
}

type AboutServiceOption func(*AboutService)

func WithAboutLogger(logger *slog.Logger) AboutServiceOption {
	return func(service *AboutService) { service.logger = logger }
}

func WithAboutAutoUpdateSource(source autoUpdateSettingSource) AboutServiceOption {
	return func(service *AboutService) { service.autoUpdateSource = source }
}

func NewAboutService(options ...any) *AboutService {
	var proxy *netproxy.Manager
	for _, option := range options {
		if manager, ok := option.(*netproxy.Manager); ok {
			proxy = manager
		}
	}
	service := &AboutService{
		client:          sharedHTTPClient(10*time.Second, proxy),
		downloadClient:  sharedHTTPClient(30*time.Minute, proxy),
		latestAPIURL:    latestAPIURL,
		releasesAPIURL:  releasesAPIURL,
		autoUpdateEvery: time.Hour,
		autoUpdateWake:  make(chan struct{}, 1),
	}
	for _, option := range options {
		if apply, ok := option.(AboutServiceOption); ok {
			apply(service)
		}
	}
	return service
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
	release, err := a.fetchLatestRelease(operationContext, Version, runtime.GOOS, runtime.GOARCH, true)
	if err != nil {
		return nil, fmt.Errorf("check update: %w", err)
	}
	return &release.Info, nil
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
