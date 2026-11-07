package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGistProviderTestAcceptsMissingConfiguredGist(t *testing.T) {
	var userCalls, gistCalls int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/user":
			userCalls++
			writer.WriteHeader(http.StatusOK)
		case "/gists/missing":
			gistCalls++
			writer.WriteHeader(http.StatusNotFound)
		default:
			writer.WriteHeader(http.StatusInternalServerError)
		}
	}))
	t.Cleanup(server.Close)

	provider, err := newGistSyncProvider(server.Client(), server.URL, "missing", "token")
	require.NoError(t, err)
	require.NoError(t, provider.Test(t.Context()))
	assert.Equal(t, 1, userCalls)
	assert.Equal(t, 1, gistCalls)
}

func TestGistProviderTestRejectsConfiguredGistAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/user" {
			writer.WriteHeader(http.StatusOK)
			return
		}
		writer.WriteHeader(http.StatusForbidden)
		_, _ = writer.Write([]byte(`{"message":"forbidden"}`))
	}))
	t.Cleanup(server.Close)

	provider, err := newGistSyncProvider(server.Client(), server.URL, "denied", "token")
	require.NoError(t, err)
	err = provider.Test(t.Context())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "403")
	assert.Contains(t, err.Error(), "forbidden")
}

func TestGistProviderRecreatesMissingConfiguredGist(t *testing.T) {
	var created, patched bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/gists/missing":
			writer.WriteHeader(http.StatusNotFound)
		case request.Method == http.MethodPost && request.URL.Path == "/gists":
			created = true
			writer.Header().Set("ETag", `"new"`)
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "created-gist"})
		case request.Method == http.MethodPatch:
			patched = true
			writer.WriteHeader(http.StatusOK)
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)

	provider, err := newGistSyncProvider(server.Client(), server.URL, "missing", "token")
	require.NoError(t, err)
	remote, err := provider.Put(t.Context(), []byte("backup"), "")
	require.NoError(t, err)
	assert.True(t, created)
	assert.False(t, patched)
	assert.Equal(t, "created-gist", remote.ProviderID)
	assert.Equal(t, "created-gist", provider.gistID)
}

func TestGistProviderAdoptsExistingGistWithoutBackup(t *testing.T) {
	var patched bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/gists/empty":
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "empty", Files: map[string]gistFile{}})
		case request.Method == http.MethodPatch && request.URL.Path == "/gists/empty":
			patched = true
			writer.Header().Set("ETag", `"next"`)
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "empty"})
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)

	provider, err := newGistSyncProvider(server.Client(), server.URL, "empty", "token")
	require.NoError(t, err)
	remote, err := provider.Put(t.Context(), []byte("backup"), "")
	require.NoError(t, err)
	assert.True(t, patched)
	assert.Equal(t, "empty", remote.ProviderID)
}

func TestGistProviderRejectsExistingBackupWithoutETag(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(writer).Encode(gistResponse{
			ID: "existing", Files: map[string]gistFile{syncBackupFileName: {Content: "remote"}},
		})
	}))
	t.Cleanup(server.Close)

	provider, err := newGistSyncProvider(server.Client(), server.URL, "existing", "token")
	require.NoError(t, err)
	_, err = provider.Put(t.Context(), []byte("backup"), "")
	require.ErrorIs(t, err, errSyncConflict)
}

func TestGistProviderPatchBadRequestIsNotConflict(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			writer.Header().Set("ETag", `"v1"`)
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "existing"})
		case http.MethodPatch:
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"message":"invalid request"}`))
		default:
			writer.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(server.Close)

	provider, err := newGistSyncProvider(server.Client(), server.URL, "existing", "token")
	require.NoError(t, err)
	_, err = provider.Put(t.Context(), []byte("backup"), `"v1"`)
	require.Error(t, err)
	assert.NotErrorIs(t, err, errSyncConflict)
	assert.Contains(t, err.Error(), "400")
	assert.Contains(t, err.Error(), "invalid request")
}
