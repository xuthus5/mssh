package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGistRawURLRejectsCredentialExfiltration(t *testing.T) {
	var attackerCalls atomic.Int32
	attacker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		attackerCalls.Add(1)
		_, writeErr := writer.Write([]byte("stolen"))
		require.NoError(t, writeErr)
	}))
	t.Cleanup(attacker.Close)
	provider, err := newGistSyncProvider(attacker.Client(), "https://api.github.com", "gist", "secret-token")
	require.NoError(t, err)

	_, err = provider.readGistFile(t.Context(), gistFile{Truncated: true, RawURL: attacker.URL})
	require.ErrorContains(t, err, "not trusted")
	assert.Zero(t, attackerCalls.Load())
}

func TestGistRawURLAllowsSameOriginWithCredential(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "Bearer secret-token", request.Header.Get("Authorization"))
		_, writeErr := writer.Write([]byte("backup"))
		require.NoError(t, writeErr)
	}))
	t.Cleanup(server.Close)
	provider, err := newGistSyncProvider(server.Client(), server.URL, "gist", "secret-token")
	require.NoError(t, err)

	content, err := provider.readGistFile(context.Background(), gistFile{Truncated: true, RawURL: server.URL + "/raw"})
	require.NoError(t, err)
	assert.Equal(t, []byte("backup"), content)
}

func TestGistRawURLRedirectCannotEscapeTrustedOrigin(t *testing.T) {
	var attackerCalls atomic.Int32
	attacker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		attackerCalls.Add(1)
		writer.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(attacker.Close)
	origin := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, attacker.URL, http.StatusFound)
	}))
	t.Cleanup(origin.Close)
	provider, err := newGistSyncProvider(origin.Client(), origin.URL, "gist", "secret-token")
	require.NoError(t, err)

	_, err = provider.readGistFile(t.Context(), gistFile{Truncated: true, RawURL: origin.URL + "/raw"})
	require.ErrorContains(t, err, "not trusted")
	assert.Zero(t, attackerCalls.Load())
}

func TestGistRawURLOfficialHostOmitsCredential(t *testing.T) {
	rawURL, includeCredential, err := validateGistRawURL(
		"https://gist.githubusercontent.com/user/gist/raw/file", "https://api.github.com",
	)
	require.NoError(t, err)
	assert.Equal(t, githubGistRawHost, rawURL.Host)
	assert.False(t, includeCredential)

	_, _, err = validateGistRawURL("https://gist.githubusercontent.com.evil.example/raw", "https://api.github.com")
	require.ErrorContains(t, err, "not trusted")
}

func TestGistAPIRejectsCrossOriginUploadRedirect(t *testing.T) {
	var targetCalls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		targetCalls.Add(1)
		writeGistResponse(t, writer, http.StatusCreated)
	}))
	t.Cleanup(target.Close)
	origin := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL+"/stolen", http.StatusTemporaryRedirect)
	}))
	t.Cleanup(origin.Close)
	provider, err := newGistSyncProvider(origin.Client(), origin.URL, "", "secret-token")
	require.NoError(t, err)

	_, err = provider.Put(t.Context(), []byte("encrypted-backup"), "")

	require.ErrorContains(t, err, "different origin")
	assert.Zero(t, targetCalls.Load())
}

func TestGistAPIDoesNotFollowMovedUploadRedirect(t *testing.T) {
	var targetCalls atomic.Int32
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/gists" {
			http.Redirect(writer, request, serverURL+"/target", http.StatusMovedPermanently)
			return
		}
		targetCalls.Add(1)
		writeGistResponse(t, writer, http.StatusOK)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)
	provider, err := newGistSyncProvider(server.Client(), server.URL, "", "secret-token")
	require.NoError(t, err)

	_, err = provider.Put(t.Context(), []byte("encrypted-backup"), "")

	require.ErrorContains(t, err, "301")
	assert.Zero(t, targetCalls.Load())
}

func TestGistAPIAllowsSameOriginUploadRedirect(t *testing.T) {
	type capturedRequest struct {
		method        string
		authorization string
		body          string
	}
	captured := make(chan capturedRequest, 1)
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/gists" {
			http.Redirect(writer, request, serverURL+"/target", http.StatusTemporaryRedirect)
			return
		}
		body, readErr := io.ReadAll(request.Body)
		if readErr != nil {
			t.Errorf("read redirected Gist body: %v", readErr)
			return
		}
		captured <- capturedRequest{request.Method, request.Header.Get("Authorization"), string(body)}
		writeGistResponse(t, writer, http.StatusCreated)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)
	provider, err := newGistSyncProvider(server.Client(), server.URL, "", "secret-token")
	require.NoError(t, err)

	remote, err := provider.Put(t.Context(), []byte("encrypted-backup"), "")

	require.NoError(t, err)
	assert.Equal(t, "gist", remote.ProviderID)
	request := <-captured
	assert.Equal(t, http.MethodPost, request.method)
	assert.Equal(t, "Bearer secret-token", request.authorization)
	assert.Contains(t, request.body, "encrypted-backup")
}

func writeGistResponse(t *testing.T, writer http.ResponseWriter, status int) {
	t.Helper()
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	if _, err := writer.Write([]byte(`{"id":"gist","files":{}}`)); err != nil {
		t.Errorf("write Gist response: %v", err)
	}
}
