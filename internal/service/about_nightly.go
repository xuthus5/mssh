package service

import (
	"fmt"
	"strings"
	"time"
)

const (
	nightlyVersionPrefix = "nightly-"
	nightlyDateLayout    = "20060102"
)

func isUpdateAvailable(releaseVersion, currentVersion, publishedAt string) (bool, error) {
	nightlyDate, isNightly, err := parseNightlyBuildDate(currentVersion)
	if err != nil {
		return false, err
	}
	if !isNightly {
		comparison, compareErr := compareVersions(releaseVersion, currentVersion)
		return comparison > 0, compareErr
	}
	if _, err := parseSemanticVersion(releaseVersion); err != nil {
		return false, fmt.Errorf("invalid version %q: %w", releaseVersion, err)
	}
	releaseDate, err := time.Parse(time.RFC3339, strings.TrimSpace(publishedAt))
	if err != nil {
		return false, fmt.Errorf("invalid release publication time %q: %w", publishedAt, err)
	}
	return releaseDate.UTC().Format(nightlyDateLayout) > nightlyDate.Format(nightlyDateLayout), nil
}

func parseNightlyBuildDate(version string) (time.Time, bool, error) {
	version = strings.TrimSpace(version)
	if !strings.HasPrefix(version, nightlyVersionPrefix) {
		return time.Time{}, false, nil
	}
	parts := strings.SplitN(strings.TrimPrefix(version, nightlyVersionPrefix), "-", 2)
	if len(parts) != 2 || parts[1] == "" {
		return time.Time{}, true, fmt.Errorf("invalid nightly version %q", version)
	}
	buildDate, err := time.Parse(nightlyDateLayout, parts[0])
	if err != nil {
		return time.Time{}, true, fmt.Errorf("invalid nightly version %q: %w", version, err)
	}
	return buildDate, true, nil
}
