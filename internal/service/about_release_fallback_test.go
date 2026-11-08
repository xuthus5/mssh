package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCheckUpdateFallsBackToNewestDownloadableRelease(t *testing.T) {
	emptyRelease := `{"tag_name":"v1.0.3","html_url":"https://github.com/xuthus5/mssh/releases/tag/v1.0.3","assets":[]}`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/latest":
			_, err := writer.Write([]byte(emptyRelease))
			require.NoError(t, err)
		case "/releases":
			_, err := writer.Write([]byte(`[` + emptyRelease + `,` + testUpdateReleaseBody("v1.0.1") + `,` + testUpdateReleaseBody("v1.0.2") + `]`))
			require.NoError(t, err)
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	service := NewAboutService()
	service.latestAPIURL = server.URL + "/latest"
	service.releasesAPIURL = server.URL + "/releases"

	info, err := service.CheckUpdate(t.Context())

	require.NoError(t, err)
	assert.True(t, info.UpdateAvailable)
	assert.Equal(t, "v1.0.2", info.LatestVersion)
	assert.Equal(t, testUpdateAssetName("v1.0.2"), info.ArtifactName)
	assert.Equal(t, "https://github.com/xuthus5/mssh/releases/tag/v1.0.2", info.ReleaseURL)
}

func TestCheckUpdateFailsWhenNoDownloadableReleaseExists(t *testing.T) {
	emptyRelease := `{"tag_name":"v1.0.3","html_url":"https://github.com/xuthus5/mssh/releases/tag/v1.0.3","assets":[]}`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body := emptyRelease
		if request.URL.Path == "/releases" {
			body = `[` + emptyRelease + `]`
		}
		_, err := writer.Write([]byte(body))
		require.NoError(t, err)
	}))
	t.Cleanup(server.Close)
	service := NewAboutService()
	service.latestAPIURL = server.URL + "/latest"
	service.releasesAPIURL = server.URL + "/releases"

	_, err := service.CheckUpdate(t.Context())

	require.ErrorIs(t, err, errUpdateAssetNotFound)
}
