package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	pathpkg "path"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestLoadDefinitionAddsPinnedMetadata(t *testing.T) {
	client := testClient(func(*http.Request) (*http.Response, error) {
		return themeResponse(http.StatusOK, generatorFixture(0.1)), nil
	})
	entry := manifestEntry{name: "Test Dark", filename: "Test Dark.itermcolors", mode: model.ThemeModeDark}

	definition, err := loadDefinition(context.Background(), client, entry)
	require.NoError(t, err)
	assert.Equal(t, entry.name, definition.Name)
	assert.Equal(t, entry.mode, definition.Mode)
	assert.Equal(t, model.ThemeSourceBuiltin, definition.SourceType)
	assert.True(t, strings.HasPrefix(definition.SourceFingerprint, "builtin:"))
	assert.Equal(t, upstreamCommit, definition.SourceVersion)
	assert.Contains(t, definition.SourceURL, "Test%20Dark.itermcolors")
	assert.Empty(t, definition.RawPayload)
	assert.True(t, definition.IsBuiltin)
}

func TestRunGeneratesCompleteCatalog(t *testing.T) {
	client := uniqueThemeClient()
	target := filepath.Join(t.TempDir(), "builtin_themes_gen.go")

	require.NoError(t, run(client, target))
	content, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, 24, strings.Count(string(content), "SourceType: model.ThemeSourceBuiltin"))
}

func TestRunReportsLoadAndWriteFailures(t *testing.T) {
	loadClient := testClient(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("network failed")
	})
	assert.ErrorContains(t, run(loadClient, filepath.Join(t.TempDir(), "themes.go")), "network failed")

	missingTarget := filepath.Join(t.TempDir(), "missing", "themes.go")
	assert.ErrorContains(t, run(uniqueThemeClient(), missingTarget), "create generated file")
}

func TestLoadDefinitionRejectsModeMismatch(t *testing.T) {
	client := testClient(func(*http.Request) (*http.Response, error) {
		return themeResponse(http.StatusOK, generatorFixture(0.9)), nil
	})
	_, err := loadDefinition(context.Background(), client, manifestEntry{name: "Wrong", filename: "Wrong.itermcolors", mode: model.ThemeModeDark})
	assert.ErrorContains(t, err, "classify Wrong")
	invalidClient := testClient(func(*http.Request) (*http.Response, error) {
		return themeResponse(http.StatusOK, "<plist>"), nil
	})
	_, err = loadDefinition(context.Background(), invalidClient, manifestEntry{name: "Invalid", filename: "Invalid.itermcolors", mode: model.ThemeModeDark})
	assert.ErrorContains(t, err, "parse Invalid")
}

func TestLoadDefinitionsRejectsDuplicateFingerprints(t *testing.T) {
	client := testClient(func(request *http.Request) (*http.Response, error) {
		background := 0.1
		if manifestMode(request.URL.Path) == model.ThemeModeLight {
			background = 0.9
		}
		return themeResponse(http.StatusOK, generatorFixture(background)), nil
	})

	_, err := loadDefinitions(context.Background(), client)
	assert.ErrorContains(t, err, "duplicate theme fingerprint")
}

func TestDownloadValidatesResponse(t *testing.T) {
	_, err := download(context.Background(), &http.Client{}, "://invalid")
	assert.ErrorContains(t, err, "create request")
	networkClient := testClient(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("connection lost")
	})
	_, err = download(context.Background(), networkClient, "https://example.com/theme")
	assert.ErrorContains(t, err, "connection lost")
	readClient := testClient(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Body: errorReadCloser{}, Header: make(http.Header)}, nil
	})
	_, err = download(context.Background(), readClient, "https://example.com/theme")
	assert.ErrorContains(t, err, "read response")

	statusClient := testClient(func(*http.Request) (*http.Response, error) {
		return themeResponse(http.StatusNotFound, "missing"), nil
	})
	_, err = download(context.Background(), statusClient, "https://example.com/theme")
	assert.ErrorContains(t, err, "404 Not Found")

	largeClient := testClient(func(*http.Request) (*http.Response, error) {
		return themeResponse(http.StatusOK, strings.Repeat("x", maxThemeBytes+1)), nil
	})
	_, err = download(context.Background(), largeClient, "https://example.com/theme")
	assert.ErrorContains(t, err, "theme exceeds")
}

func uniqueThemeClient() *http.Client {
	return testClient(func(request *http.Request) (*http.Response, error) {
		index, entry := manifestEntryForPath(request.URL.Path)
		background := 0.05 + float64(index)*0.02
		if entry.mode == model.ThemeModeLight {
			background = 0.7 + float64(index-12)*0.02
		}
		return themeResponse(http.StatusOK, generatorFixture(background)), nil
	})
}

func TestRenderAndWriteGeneratedDefinitions(t *testing.T) {
	definition, err := loadDefinition(context.Background(), testClient(func(*http.Request) (*http.Response, error) {
		return themeResponse(http.StatusOK, generatorFixture(0.1)), nil
	}), manifestEntry{name: "Generated", filename: "Generated.itermcolors", mode: model.ThemeModeDark})
	require.NoError(t, err)
	source, err := renderDefinitions([]model.ThemeDefinition{definition})
	require.NoError(t, err)
	assert.Contains(t, string(source), "func builtinThemeDefinitions()")
	assert.Contains(t, string(source), "Generated")

	target := filepath.Join(t.TempDir(), "builtin_themes_gen.go")
	require.NoError(t, writeGeneratedFile(target, source))
	content, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, source, content)
	info, err := os.Stat(target)
	require.NoError(t, err)
	if runtime.GOOS != "windows" {
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	}

	directoryTarget := t.TempDir()
	assert.ErrorContains(t, writeGeneratedFile(directoryTarget, source), "replace generated file")
}

func testClient(roundTrip roundTripFunc) *http.Client {
	return &http.Client{Transport: roundTrip}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (roundTrip roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

type errorReadCloser struct{}

func (errorReadCloser) Read([]byte) (int, error) { return 0, errors.New("read failed") }

func (errorReadCloser) Close() error { return nil }

func themeResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Status: fmt.Sprintf("%d %s", status, http.StatusText(status)), Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func manifestMode(path string) model.ThemeMode {
	_, entry := manifestEntryForPath(path)
	return entry.mode
}

func manifestEntryForPath(path string) (int, manifestEntry) {
	filename, _ := url.PathUnescape(pathpkg.Base(path))
	for index, entry := range manifest {
		if filename == entry.filename {
			return index, entry
		}
	}
	return 0, manifest[0]
}

func generatorFixture(background float64) string {
	colors := []string{
		generatorColor("Background Color", background),
		generatorColor("Foreground Color", 0.8),
		generatorColor("Cursor Color", 0.7),
		generatorColor("Selection Color", 0.6),
	}
	for index := range 16 {
		colors = append(colors, generatorColor(fmt.Sprintf("Ansi %d Color", index), float64(index)/15))
	}
	return `<?xml version="1.0"?>` + plistDoctype + `<plist><dict>` + strings.Join(colors, "") + `</dict></plist>`
}

func generatorColor(name string, component float64) string {
	return fmt.Sprintf(`<key>%s</key><dict><key>Red Component</key><real>%.6f</real><key>Green Component</key><real>%.6f</real><key>Blue Component</key><real>%.6f</real></dict>`, name, component, component, component)
}
