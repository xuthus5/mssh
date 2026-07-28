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

	"github.com/xuthus5/mssh/internal/model"
)

func TestPostJSONRejectsCrossOriginTemporaryRedirect(t *testing.T) {
	client, endpoint, targetCalls := newCrossOriginRedirectEndpoint(t, http.StatusTemporaryRedirect)
	output := map[string]any{}

	err := postJSON(t.Context(), client, endpoint, "provider-secret", "", map[string]string{
		"prompt": "private terminal context",
	}, &output)

	require.ErrorContains(t, err, "different origin")
	assert.Zero(t, targetCalls.Load())
}

func TestPostJSONDoesNotFollowMovedRedirect(t *testing.T) {
	var targetCalls atomic.Int32
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/source" {
			http.Redirect(writer, request, serverURL+"/target", http.StatusMovedPermanently)
			return
		}
		targetCalls.Add(1)
		writeJSONResponse(t, writer, `{"ok":true}`)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)

	err := postJSON(t.Context(), server.Client(), server.URL+"/source", "secret", "", map[string]string{
		"prompt": "private terminal context",
	}, &map[string]any{})

	require.ErrorContains(t, err, "301")
	assert.Zero(t, targetCalls.Load())
}

func TestPostJSONAllowsSameOriginTemporaryRedirect(t *testing.T) {
	type capturedRequest struct {
		method        string
		authorization string
		body          string
	}
	captured := make(chan capturedRequest, 1)
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/source" {
			http.Redirect(writer, request, serverURL+"/target", http.StatusTemporaryRedirect)
			return
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("read redirected AI body: %v", err)
			return
		}
		captured <- capturedRequest{method: request.Method, authorization: request.Header.Get("Authorization"), body: string(body)}
		writeJSONResponse(t, writer, `{"ok":true}`)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)

	var output struct {
		OK bool `json:"ok"`
	}
	err := postJSON(t.Context(), server.Client(), server.URL+"/source", "provider-secret", "", map[string]string{
		"prompt": "private terminal context",
	}, &output)

	require.NoError(t, err)
	assert.True(t, output.OK)
	request := <-captured
	assert.Equal(t, http.MethodPost, request.method)
	assert.Equal(t, "Bearer provider-secret", request.authorization)
	assert.JSONEq(t, `{"prompt":"private terminal context"}`, request.body)
}

func TestSearchProvidersRejectCrossOriginRedirect(t *testing.T) {
	tests := []model.AISearchProvider{
		model.AISearchProviderTavily,
		model.AISearchProviderSerper,
		model.AISearchProviderBrave,
	}
	for _, provider := range tests {
		t.Run(string(provider), func(t *testing.T) {
			assertSearchRedirectRejected(t, provider)
		})
	}
}

func assertSearchRedirectRejected(t *testing.T, provider model.AISearchProvider) {
	t.Helper()
	client, endpoint, targetCalls := newCrossOriginRedirectEndpoint(t, http.StatusTemporaryRedirect)
	restoreSearchEndpoint(t, provider, endpoint)
	settings := model.AISearchSettings{
		Enabled: true, Mode: model.AISearchIndependent, Provider: provider, TimeoutSeconds: 5, MaxResults: 3,
	}

	_, err := searchAI(context.Background(), client, settings, "search-secret", "private query")

	require.ErrorContains(t, err, "different origin")
	assert.Zero(t, targetCalls.Load())
}

func newCrossOriginRedirectEndpoint(t *testing.T, status int) (*http.Client, string, *atomic.Int32) {
	t.Helper()
	targetCalls := &atomic.Int32{}
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		targetCalls.Add(1)
		writeJSONResponse(t, writer, `{}`)
	}))
	t.Cleanup(target.Close)
	origin := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL+"/stolen", status)
	}))
	t.Cleanup(origin.Close)
	return origin.Client(), origin.URL, targetCalls
}

func writeJSONResponse(t *testing.T, writer http.ResponseWriter, body string) {
	t.Helper()
	writer.Header().Set("Content-Type", "application/json")
	if _, err := writer.Write([]byte(body)); err != nil {
		t.Errorf("write JSON response: %v", err)
	}
}
