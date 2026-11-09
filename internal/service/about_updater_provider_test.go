package service

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestAboutUpdateProviderCheck(t *testing.T) {
	t.Run("requires service", func(t *testing.T) {
		provider := &aboutUpdateProvider{}
		_, err := provider.Check(t.Context(), updater.CheckRequest{})
		require.ErrorContains(t, err, "about service is required")
	})

	t.Run("returns available release", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			_, err := writer.Write([]byte(testUpdateReleaseBody("v0.2.0")))
			require.NoError(t, err)
		}))
		t.Cleanup(server.Close)
		service := NewAboutService()
		service.latestAPIURL = server.URL
		provider := NewAboutUpdateProvider(service)

		release, err := provider.Check(t.Context(), updater.CheckRequest{CurrentVersion: "0.1.0"})

		require.NoError(t, err)
		require.NotNil(t, release)
		assert.Equal(t, "mssh-github", provider.Name())
		assert.Equal(t, "v0.2.0", release.Version)
		assert.Equal(t, "v0.2.0", release.Name)
		assert.Equal(t, testUpdateAssetName("v0.2.0"), release.Artifact.Filename)
		assert.Equal(t, "application/octet-stream", release.Artifact.Filetype)
		assert.Equal(t, int64(128), release.Artifact.Size)
		assert.Equal(t, runtime.GOOS, release.Artifact.Platform)
		assert.Equal(t, runtime.GOARCH, release.Artifact.Arch)
		assert.Equal(t, "https://github.com/xuthus5/mssh/releases/download/v0.2.0/"+testUpdateAssetName("v0.2.0"), release.Metadata[updateDownloadURLMetadata])
	})

	t.Run("returns nil when current version is latest", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			_, err := writer.Write([]byte(testUpdateReleaseBody("v0.2.0")))
			require.NoError(t, err)
		}))
		t.Cleanup(server.Close)
		service := NewAboutService()
		service.latestAPIURL = server.URL
		provider := NewAboutUpdateProvider(service)

		release, err := provider.Check(t.Context(), updater.CheckRequest{
			CurrentVersion: "v0.2.0", Platform: "linux", Arch: "amd64",
		})

		require.NoError(t, err)
		assert.Nil(t, release)
	})

	t.Run("returns release lookup error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(http.StatusInternalServerError)
		}))
		t.Cleanup(server.Close)
		service := NewAboutService()
		service.latestAPIURL = server.URL
		provider := NewAboutUpdateProvider(service)

		_, err := provider.Check(t.Context(), updater.CheckRequest{CurrentVersion: "0.1.0"})

		require.ErrorContains(t, err, "500")
	})
}

func TestAboutUpdateProviderDownload(t *testing.T) {
	t.Run("streams artifact and reports progress", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Content-Length", "8")
			_, err := writer.Write([]byte("artifact"))
			require.NoError(t, err)
		}))
		t.Cleanup(server.Close)
		service := NewAboutService()
		service.downloadClient = server.Client()
		provider := NewAboutUpdateProvider(service)
		var destination bytes.Buffer
		var written, total int64

		err := provider.Download(t.Context(), &updater.Release{
			Metadata: map[string]any{updateDownloadURLMetadata: server.URL},
		}, &destination, func(current, expected int64) {
			written, total = current, expected
		})

		require.NoError(t, err)
		assert.Equal(t, "artifact", destination.String())
		assert.Equal(t, int64(len("artifact")), written)
		assert.Equal(t, int64(len("artifact")), total)
	})

	t.Run("uses artifact size when available", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			_, err := writer.Write([]byte("artifact"))
			require.NoError(t, err)
		}))
		t.Cleanup(server.Close)
		service := NewAboutService()
		service.downloadClient = server.Client()
		provider := NewAboutUpdateProvider(service)
		var total int64

		err := provider.Download(t.Context(), &updater.Release{
			Artifact: updater.Artifact{Size: 99},
			Metadata: map[string]any{updateDownloadURLMetadata: server.URL},
		}, io.Discard, func(_, expected int64) { total = expected })

		require.NoError(t, err)
		assert.Equal(t, int64(99), total)
	})

	t.Run("validates release metadata", func(t *testing.T) {
		provider := &aboutUpdateProvider{}
		require.ErrorContains(t, provider.Download(t.Context(), &updater.Release{}, io.Discard, nil), "about service is required")

		provider.service = NewAboutService()
		require.ErrorContains(t, provider.Download(t.Context(), &updater.Release{}, io.Discard, nil), "download URL is missing")
		require.ErrorContains(t, provider.Download(t.Context(), &updater.Release{
			Metadata: map[string]any{updateDownloadURLMetadata: "https://user:pass@example.com/update"},
		}, io.Discard, nil), "must not include credentials")
	})

	t.Run("reports transport and status errors", func(t *testing.T) {
		service := NewAboutService()
		service.downloadClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("offline")
		})}
		provider := NewAboutUpdateProvider(service)
		release := &updater.Release{Metadata: map[string]any{updateDownloadURLMetadata: "https://github.com/xuthus5/mssh/releases/download/v0.2.0/update"}}
		require.ErrorContains(t, provider.Download(t.Context(), release, io.Discard, nil), "offline")

		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(http.StatusBadGateway)
		}))
		t.Cleanup(server.Close)
		service.downloadClient = server.Client()
		release.Metadata[updateDownloadURLMetadata] = server.URL
		require.ErrorContains(t, provider.Download(t.Context(), release, io.Discard, nil), "502")
	})

	t.Run("falls back to primary client", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			_, err := writer.Write([]byte("artifact"))
			require.NoError(t, err)
		}))
		t.Cleanup(server.Close)
		service := NewAboutService()
		service.downloadClient = nil
		service.client = server.Client()
		provider := NewAboutUpdateProvider(service)

		err := provider.Download(t.Context(), &updater.Release{
			Metadata: map[string]any{updateDownloadURLMetadata: server.URL},
		}, io.Discard, nil)

		require.NoError(t, err)
	})
}

func TestCopyUpdatePropagatesErrors(t *testing.T) {
	var destination bytes.Buffer
	var progress []int64
	require.NoError(t, copyUpdate(strings.NewReader("data"), &destination, 4, func(written, total int64) {
		progress = append(progress, written, total)
	}))
	assert.Equal(t, "data", destination.String())
	assert.Equal(t, []int64{4, 4}, progress)

	require.NoError(t, copyUpdate(strings.NewReader("data"), io.Discard, 0, nil))
	require.ErrorIs(t, copyUpdate(providerReadError{}, io.Discard, 0, nil), assert.AnError)
	require.ErrorIs(t, copyUpdate(strings.NewReader("data"), providerWriteError{}, 0, nil), assert.AnError)
}

func TestChecksumDigest(t *testing.T) {
	target := "mssh-0.2.0-linux-amd64"
	valid := strings.Repeat("ab", 32)
	content := fmt.Sprintf("ignored\n%s *./%s\n%s other-file\n", valid, target, strings.Repeat("cd", 32))

	digest, err := checksumDigest(content, target)

	require.NoError(t, err)
	assert.Equal(t, strings.Repeat("\xab", 32), string(digest))

	_, err = checksumDigest("not-a-digest "+target, target)
	require.ErrorContains(t, err, "malformed checksum")
	_, err = checksumDigest(valid+" other-file", target)
	require.ErrorContains(t, err, "missing")
}

func TestFetchUpdateDigest(t *testing.T) {
	const tag = "v0.2.0"
	const target = "mssh-0.2.0-linux-amd64"
	const checksumName = "mssh-0.2.0-SHA256SUMS"
	checksumURL := "https://github.com/xuthus5/mssh/releases/download/" + tag + "/" + checksumName
	digest := strings.Repeat("ab", 32)
	release := githubReleaseResponse{
		TagName: tag,
		Assets:  []githubReleaseAsset{{Name: checksumName, BrowserDownloadURL: checksumURL}},
	}

	t.Run("parses checksum", func(t *testing.T) {
		service := NewAboutService()
		service.client = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			assert.Equal(t, checksumURL, request.URL.String())
			return providerResponse(http.StatusOK, digest+"  "+target+"\n"), nil
		})}

		got, err := service.fetchUpdateDigest(t.Context(), release, target)

		require.NoError(t, err)
		assert.Equal(t, strings.Repeat("\xab", 32), string(got))
	})

	t.Run("reports request failures", func(t *testing.T) {
		service := NewAboutService()
		service.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("offline")
		})}
		_, err := service.fetchUpdateDigest(t.Context(), release, target)
		require.ErrorContains(t, err, "download checksum")
	})

	t.Run("rejects untrusted checksum URL", func(t *testing.T) {
		service := NewAboutService()
		untrusted := release
		untrusted.Assets = []githubReleaseAsset{{Name: checksumName, BrowserDownloadURL: "https://example.com/checksum"}}
		_, err := service.fetchUpdateDigest(t.Context(), untrusted, target)
		require.ErrorContains(t, err, "not trusted")
	})

	t.Run("reports status and body errors", func(t *testing.T) {
		service := NewAboutService()
		service.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return providerResponse(http.StatusBadGateway, ""), nil
		})}
		_, err := service.fetchUpdateDigest(t.Context(), release, target)
		require.ErrorContains(t, err, "502")

		service.client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(providerReadError{})}, nil
		})}
		_, err = service.fetchUpdateDigest(t.Context(), release, target)
		require.ErrorContains(t, err, "read checksum")
	})

	t.Run("returns nil when checksum asset is absent", func(t *testing.T) {
		checksum, err := NewAboutService().fetchUpdateDigest(t.Context(), githubReleaseResponse{TagName: tag}, target)
		require.NoError(t, err)
		assert.Nil(t, checksum)
	})
}

func TestLogAutoUpdateError(t *testing.T) {
	service := NewAboutService(WithAboutLogger(slog.New(slog.NewTextHandler(io.Discard, nil))))
	service.logAutoUpdateError("without error", nil)
	service.logAutoUpdateError("with error", assert.AnError)
	NewAboutService().logAutoUpdateError("without logger", assert.AnError)
}

type providerReadError struct{}

func (providerReadError) Read([]byte) (int, error) { return 0, assert.AnError }

type providerWriteError struct{}

func (providerWriteError) Write([]byte) (int, error) { return 0, assert.AnError }

func providerResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
