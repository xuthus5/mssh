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
	var lastPatchBody map[string]any
	var lastPatchHadIfMatch bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "Bearer token", request.Header.Get("Authorization"))
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/user":
			writer.WriteHeader(http.StatusOK)
		case request.Method == http.MethodPost && request.URL.Path == "/gists":
			var body map[string]any
			require.NoError(t, json.NewDecoder(request.Body).Decode(&body))
			assert.Equal(t, false, body["public"])
			files, ok := body["files"].(map[string]any)
			require.True(t, ok)
			file, ok := files[syncBackupFileName].(map[string]any)
			require.True(t, ok)
			content, _ = file["content"].(string)
			writer.Header().Set("ETag", etag)
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "gist-1"})
		case request.Method == http.MethodGet && request.URL.Path == "/gists/gist-1":
			writer.Header().Set("ETag", etag)
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "gist-1", Files: map[string]gistFile{syncBackupFileName: {Content: content}}})
		case request.Method == http.MethodPatch && request.URL.Path == "/gists/gist-1":
			lastPatchHadIfMatch = request.Header.Get("If-Match") != ""
			require.NoError(t, json.NewDecoder(request.Body).Decode(&lastPatchBody))
			// 模拟真实 GitHub：PATCH 不支持 If-Match / public，否则 400。
			if lastPatchHadIfMatch {
				writer.WriteHeader(http.StatusBadRequest)
				_, _ = writer.Write([]byte(`{"message":"Invalid request"}`))
				return
			}
			if _, hasPublic := lastPatchBody["public"]; hasPublic {
				writer.WriteHeader(http.StatusBadRequest)
				_, _ = writer.Write([]byte(`{"message":"Invalid request"}`))
				return
			}
			files, ok := lastPatchBody["files"].(map[string]any)
			require.True(t, ok)
			file, ok := files[syncBackupFileName].(map[string]any)
			require.True(t, ok)
			content, _ = file["content"].(string)
			writer.Header().Set("ETag", `"v2"`)
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

	updated, err := provider.Put(t.Context(), []byte("next"), etag)
	require.NoError(t, err)
	assert.Equal(t, `"v2"`, updated.ETag)
	assert.False(t, lastPatchHadIfMatch)
	_, hasPublic := lastPatchBody["public"]
	assert.False(t, hasPublic)
	assert.Equal(t, "next", content)

	_, err = provider.Put(t.Context(), []byte("stale"), `"stale"`)
	assert.ErrorIs(t, err, errSyncConflict)
}

func TestNormalizeETagAndGistAPIError(t *testing.T) {
	assert.True(t, etagEqual(`"abc"`, `W/"abc"`))
	assert.Equal(t, "abc", normalizeETag(` W/"abc" `))

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte(`{"message":"Invalid request"}`))
	}))
	defer server.Close()
	provider, err := newGistSyncProvider(server.Client(), server.URL, "gist-1", "token")
	require.NoError(t, err)
	_, err = provider.Put(t.Context(), []byte("backup"), "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "400")
	assert.Contains(t, err.Error(), "Invalid request")
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
