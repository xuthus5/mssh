package service

import (
	"net/http"
	"net/http/httptest"
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
	assert.Equal(t, 1, compareVersions("v1.2.0", "1.1.9"))
	assert.Equal(t, 0, compareVersions("v1.0.0", "1.0.0"))
	assert.Equal(t, -1, compareVersions("0.9.0", "1.0.0"))
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
