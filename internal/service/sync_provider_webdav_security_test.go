package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWebDAVProviderRejectsCrossOriginUploadRedirect(t *testing.T) {
	var attackerCalls atomic.Int32
	attacker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attackerCalls.Add(1)
		_, readErr := io.ReadAll(request.Body)
		if readErr != nil {
			t.Errorf("read redirected WebDAV body: %v", readErr)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(attacker.Close)

	origin := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, attacker.URL+"/stolen", http.StatusTemporaryRedirect)
	}))
	t.Cleanup(origin.Close)

	provider, err := newWebDAVSyncProvider(sharedHTTPClient(2*time.Second, nil), origin.URL, "alice", "secret")
	require.NoError(t, err)

	_, err = provider.Put(t.Context(), []byte("encrypted-backup"), "")
	require.ErrorContains(t, err, "different origin")
	assert.Zero(t, attackerCalls.Load())
}

func TestWebDAVProviderAllowsSameOriginUploadRedirect(t *testing.T) {
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/.msshbackup" {
			http.Redirect(writer, request, serverURL+"/storage/.msshbackup", http.StatusTemporaryRedirect)
			return
		}
		username, password, ok := request.BasicAuth()
		assert.True(t, ok)
		assert.Equal(t, "alice", username)
		assert.Equal(t, "secret", password)
		content, readErr := io.ReadAll(request.Body)
		if readErr != nil {
			t.Errorf("read same-origin WebDAV body: %v", readErr)
			return
		}
		assert.Equal(t, []byte("encrypted-backup"), content)
		writer.Header().Set("ETag", `"v1"`)
		writer.WriteHeader(http.StatusNoContent)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)

	provider, err := newWebDAVSyncProvider(sharedHTTPClient(2*time.Second, nil), server.URL, "alice", "secret")
	require.NoError(t, err)

	remote, err := provider.Put(t.Context(), []byte("encrypted-backup"), "")
	require.NoError(t, err)
	assert.Equal(t, `"v1"`, remote.ETag)
}

func TestWebDAVProviderDoesNotFollowMovedUploadRedirect(t *testing.T) {
	var redirectedCalls atomic.Int32
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/.msshbackup" {
			http.Redirect(writer, request, serverURL+"/storage/.msshbackup", http.StatusMovedPermanently)
			return
		}
		redirectedCalls.Add(1)
		writer.WriteHeader(http.StatusOK)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)

	provider, err := newWebDAVSyncProvider(sharedHTTPClient(2*time.Second, nil), server.URL, "alice", "secret")
	require.NoError(t, err)

	_, err = provider.Put(t.Context(), []byte("encrypted-backup"), "")
	require.Error(t, err)
	assert.Zero(t, redirectedCalls.Load())
}

func TestWebDAVProviderRequiresHTTPClient(t *testing.T) {
	_, err := newWebDAVSyncProvider(nil, "https://dav.example.com", "", "")
	require.ErrorContains(t, err, "HTTP client")
}

func TestSameHTTPOrigin(t *testing.T) {
	httpsDefault, err := url.Parse("https://dav.example.com/backups")
	require.NoError(t, err)
	httpsExplicit, err := url.Parse("https://DAV.example.com:443/next")
	require.NoError(t, err)
	httpsOtherPort, err := url.Parse("https://dav.example.com:8443/next")
	require.NoError(t, err)
	httpDefault, err := url.Parse("http://dav.example.com/next")
	require.NoError(t, err)

	assert.True(t, sameHTTPOrigin(httpsDefault, httpsExplicit))
	assert.False(t, sameHTTPOrigin(httpsDefault, httpsOtherPort))
	assert.False(t, sameHTTPOrigin(httpsDefault, httpDefault))
	assert.False(t, sameHTTPOrigin(nil, httpsDefault))
}

func TestSameOriginHTTPClientRequiresRedirectResponse(t *testing.T) {
	origin, err := url.Parse("https://dav.example.com")
	require.NoError(t, err)
	client := sameOriginHTTPClient(&http.Client{}, origin)
	request, err := http.NewRequest(http.MethodGet, "https://dav.example.com/next", nil)
	require.NoError(t, err)

	require.ErrorContains(t, client.CheckRedirect(request, nil), "response")
}

func TestWebDAVProviderRejectsDeferredUploadStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(server.Close)
	provider, err := newWebDAVSyncProvider(server.Client(), server.URL, "", "")
	require.NoError(t, err)

	_, err = provider.Put(t.Context(), []byte("encrypted-backup"), "")
	require.ErrorContains(t, err, "202")
}
