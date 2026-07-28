package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAboutServiceCheckUpdate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "mssh/"+Version, request.Header.Get("User-Agent"))
		_, err := writer.Write([]byte(`{"tag_name":"v0.2.0","html_url":"https://github.com/xuthus5/mssh/releases/tag/v0.2.0"}`))
		require.NoError(t, err)
	}))
	defer server.Close()
	service := NewAboutService()
	service.latestAPIURL = server.URL

	info, err := service.CheckUpdate(t.Context())

	require.NoError(t, err)
	assert.True(t, info.UpdateAvailable)
	assert.Equal(t, "v0.2.0", info.LatestVersion)
}

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		name        string
		left, right string
		expected    int
	}{
		{name: "newer core", left: "v1.2.0", right: "1.1.9", expected: 1},
		{name: "same version", left: "v1.0.0", right: "1.0.0", expected: 0},
		{name: "older core", left: "0.9.0", right: "1.0.0", expected: -1},
		{name: "stable after prerelease", left: "1.0.0", right: "1.0.0-rc.1", expected: 1},
		{name: "numeric prerelease order", left: "1.0.0-rc.10", right: "1.0.0-rc.2", expected: 1},
		{name: "build metadata ignored", left: "1.0.0+linux", right: "1.0.0+windows", expected: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			comparison, err := compareVersions(test.left, test.right)
			require.NoError(t, err)
			assert.Equal(t, test.expected, comparison)
		})
	}
	for _, version := range []string{"next", "1.0", "1.0.0-", "1.0.0-01"} {
		_, err := compareVersions(version, "1.0.0")
		assert.Error(t, err)
	}
}

func TestAboutServiceInfo(t *testing.T) {
	info := NewAboutService().Info()
	assert.Equal(t, Version, info.CurrentVersion)
	assert.Equal(t, RepositoryURL, info.RepositoryURL)
}

func TestAboutServiceCheckUpdateErrors(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		body       string
	}{
		{name: "github error", statusCode: http.StatusForbidden, body: `{}`},
		{name: "invalid json", statusCode: http.StatusOK, body: `{`},
		{name: "missing version", statusCode: http.StatusOK, body: `{"tag_name":""}`},
		{name: "invalid version", statusCode: http.StatusOK, body: `{"tag_name":"next","html_url":"https://github.com/xuthus5/mssh/releases/tag/next"}`},
		{name: "untrusted release URL", statusCode: http.StatusOK, body: `{"tag_name":"v0.2.0","html_url":"https://example.com/mssh"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.statusCode)
				_, err := writer.Write([]byte(test.body))
				require.NoError(t, err)
			}))
			defer server.Close()
			service := NewAboutService()
			service.latestAPIURL = server.URL

			_, err := service.CheckUpdate(t.Context())
			require.Error(t, err)
		})
	}
}

func TestAboutServiceCheckUpdateRejectsOversizedResponse(t *testing.T) {
	body := `{"tag_name":"v0.2.0","html_url":"https://github.com/xuthus5/mssh/releases/tag/v0.2.0","padding":"` + strings.Repeat("x", 1<<20) + `"}`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, err := writer.Write([]byte(body))
		require.NoError(t, err)
	}))
	t.Cleanup(server.Close)
	service := NewAboutService()
	service.latestAPIURL = server.URL

	_, err := service.CheckUpdate(t.Context())
	require.ErrorContains(t, err, "exceeds")
}
