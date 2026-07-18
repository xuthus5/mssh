package service

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGistProviderCreatesFetchesAndProtectsUpdates(t *testing.T) {
	var content string
	etag := `"v1"`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "Bearer token", request.Header.Get("Authorization"))
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/user":
			writer.WriteHeader(http.StatusOK)
		case request.Method == http.MethodPost && request.URL.Path == "/gists":
			var body struct {
				Files map[string]struct {
					Content string `json:"content"`
				} `json:"files"`
			}
			require.NoError(t, json.NewDecoder(request.Body).Decode(&body))
			content = body.Files[syncBackupFileName].Content
			writer.Header().Set("ETag", etag)
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "gist-1"})
		case request.Method == http.MethodGet && request.URL.Path == "/gists/gist-1":
			writer.Header().Set("ETag", etag)
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "gist-1", Files: map[string]gistFile{syncBackupFileName: {Content: content}}})
		case request.Method == http.MethodPatch && request.URL.Path == "/gists/gist-1":
			if request.Header.Get("If-Match") != etag {
				writer.WriteHeader(http.StatusPreconditionFailed)
				return
			}
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "gist-1"})
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	provider, err := newGistSyncProvider(server.Client(), server.URL, "", "token")
	require.NoError(t, err)
	require.NoError(t, provider.Test(t.Context()))
	created, err := provider.Put(t.Context(), []byte("backup"), "")
	require.NoError(t, err)
	assert.Equal(t, "gist-1", created.ProviderID)
	fetched, err := provider.Fetch(t.Context())
	require.NoError(t, err)
	assert.Equal(t, []byte("backup"), fetched.Content)
	_, err = provider.Put(t.Context(), []byte("next"), `"stale"`)
	assert.ErrorIs(t, err, errSyncConflict)
}

func TestWebDAVProviderUsesFixedBackupFile(t *testing.T) {
	var content []byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case "PROPFIND":
			writer.WriteHeader(http.StatusMultiStatus)
		case http.MethodGet:
			if request.URL.Path != "/backups/.msshbackup" || content == nil {
				writer.WriteHeader(http.StatusNotFound)
				return
			}
			writer.Header().Set("ETag", `"v1"`)
			_, _ = writer.Write(content)
		case http.MethodPut:
			content, _ = io.ReadAll(request.Body)
			writer.Header().Set("ETag", `"v1"`)
			writer.WriteHeader(http.StatusNoContent)
		}
	}))
	defer server.Close()
	provider, err := newWebDAVSyncProvider(server.Client(), server.URL+"/backups", "", "")
	require.NoError(t, err)
	require.NoError(t, provider.Test(t.Context()))
	_, err = provider.Put(t.Context(), []byte("backup"), "")
	require.NoError(t, err)
	remote, err := provider.Fetch(t.Context())
	require.NoError(t, err)
	assert.Equal(t, []byte("backup"), remote.Content)
}
