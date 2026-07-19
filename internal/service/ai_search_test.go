package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSearchAIProviders(t *testing.T) {
	tests := []struct {
		name     string
		provider model.AISearchProvider
		response string
		expected string
	}{
		{name: "brave", provider: model.AISearchProviderBrave, response: `{"web":{"results":[{"title":"Brave","url":"https://example.com/brave","description":"result"}]}}`, expected: "Brave"},
		{name: "tavily", provider: model.AISearchProviderTavily, response: `{"results":[{"title":"Tavily","url":"https://example.com/tavily","content":"result"}]}`, expected: "Tavily"},
		{name: "serper", provider: model.AISearchProviderSerper, response: `{"organic":[{"title":"Serper","link":"https://example.com/serper","snippet":"result"}]}`, expected: "Serper"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) { testSearchProvider(t, test.provider, test.response, test.expected) })
	}
}

func testSearchProvider(t *testing.T, provider model.AISearchProvider, responseBody, expected string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if provider == model.AISearchProviderBrave {
			assert.Equal(t, "secret", request.Header.Get("X-Subscription-Token"))
		}
		if provider == model.AISearchProviderSerper {
			assert.Equal(t, "secret", request.Header.Get("X-API-KEY"))
		}
		writer.Header().Set("Content-Type", "application/json")
		_, err := writer.Write([]byte(responseBody))
		require.NoError(t, err)
	}))
	t.Cleanup(server.Close)
	restoreSearchEndpoint(t, provider, server.URL)
	settings := model.AISearchSettings{Enabled: true, Mode: model.AISearchIndependent, Provider: provider, TimeoutSeconds: 5, MaxResults: 3}
	results, err := searchAI(context.Background(), server.Client(), settings, "secret", "query")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, expected, results[0].Title)
}

func restoreSearchEndpoint(t *testing.T, provider model.AISearchProvider, endpoint string) {
	t.Helper()
	switch provider {
	case model.AISearchProviderBrave:
		original := braveSearchEndpoint
		braveSearchEndpoint = endpoint
		t.Cleanup(func() { braveSearchEndpoint = original })
	case model.AISearchProviderTavily:
		original := tavilySearchEndpoint
		tavilySearchEndpoint = endpoint
		t.Cleanup(func() { tavilySearchEndpoint = original })
	case model.AISearchProviderSerper:
		original := serperSearchEndpoint
		serperSearchEndpoint = endpoint
		t.Cleanup(func() { serperSearchEndpoint = original })
	}
}

func TestSearchAIShortCircuitsAndErrors(t *testing.T) {
	settings := model.AISearchSettings{Enabled: false, Mode: model.AISearchDisabled}
	results, err := searchAI(context.Background(), http.DefaultClient, settings, "", "")
	require.NoError(t, err)
	assert.Empty(t, results)
	settings = model.AISearchSettings{Enabled: true, Mode: model.AISearchIndependent, Provider: "unsupported"}
	_, err = searchAI(context.Background(), http.DefaultClient, settings, "secret", "query")
	assert.ErrorContains(t, err, "unsupported")
	assert.Equal(t, 10*time.Second, timeDuration(0))
}

func TestSearchRequestErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/status" {
			writer.WriteHeader(http.StatusBadGateway)
			return
		}
		_, _ = writer.Write([]byte("not-json"))
	}))
	t.Cleanup(server.Close)
	assert.ErrorContains(t, getJSON(context.Background(), server.Client(), server.URL+"/status", nil, &map[string]any{}), "502")
	assert.ErrorContains(t, getJSON(context.Background(), server.Client(), server.URL+"/decode", nil, &map[string]any{}), "decode")
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("offline") })}
	assert.ErrorContains(t, getJSON(context.Background(), client, "https://example.com", nil, &map[string]any{}), "offline")
	assert.Error(t, postSearchJSON(context.Background(), server.Client(), "://bad", nil, map[string]string{}, &map[string]any{}))
	assert.Error(t, postSearchJSON(context.Background(), server.Client(), server.URL, nil, map[string]any{"bad": make(chan int)}, &map[string]any{}))
}
