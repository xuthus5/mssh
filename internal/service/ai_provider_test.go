package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestChatProviderProtocols(t *testing.T) {
	tests := []struct {
		name     string
		provider model.AIProviderType
		path     string
		response string
		expected string
	}{
		{name: "openai", provider: model.AIProviderOpenAICompatible, path: "/chat/completions", response: `{"choices":[{"message":{"content":"openai"}}]}`, expected: "openai"},
		{name: "anthropic", provider: model.AIProviderAnthropic, path: "/v1/messages", response: `{"content":[{"text":"anthropic"}]}`, expected: "anthropic"},
		{name: "gemini", provider: model.AIProviderGemini, path: "/v1beta/models/model:generateContent", response: `{"candidates":[{"content":{"parts":[{"text":"gemini"}]}}]}`, expected: "gemini"},
		{name: "ollama", provider: model.AIProviderOllama, path: "/api/chat", response: `{"message":{"content":"ollama"}}`, expected: "ollama"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) { testProviderProtocol(t, test.provider, test.path, test.response, test.expected) })
	}
}

func testProviderProtocol(t *testing.T, provider model.AIProviderType, expectedPath, responseBody, expected string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, expectedPath, request.URL.Path)
		assert.Equal(t, http.MethodPost, request.Method)
		writer.Header().Set("Content-Type", "application/json")
		_, err := writer.Write([]byte(responseBody))
		require.NoError(t, err)
	}))
	defer server.Close()
	answer, err := chatWithProvider(context.Background(), server.Client(), model.AIProviderProfile{Provider: provider, BaseURL: server.URL, DefaultModel: "model"}, "secret", aiChatInput{System: "system", Prompt: "prompt", Context: "context"})
	require.NoError(t, err)
	assert.Equal(t, expected, answer)
}

func TestNativeSearchProtocols(t *testing.T) {
	tests := []struct {
		provider model.AIProviderType
		path     string
		response string
	}{
		{provider: model.AIProviderOpenAICompatible, path: "/responses", response: `{"output_text":"openai search"}`},
		{provider: model.AIProviderAnthropic, path: "/v1/messages", response: `{"content":[{"type":"text","text":"anthropic search"}]}`},
		{provider: model.AIProviderGemini, path: "/v1beta/models/model:generateContent", response: `{"candidates":[{"content":{"parts":[{"text":"gemini search"}]}}]}`},
	}
	for _, test := range tests {
		t.Run(string(test.provider), func(t *testing.T) { testNativeSearchProtocol(t, test.provider, test.path, test.response) })
	}
}

func testNativeSearchProtocol(t *testing.T, provider model.AIProviderType, expectedPath, responseBody string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, expectedPath, request.URL.Path)
		var payload map[string]any
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.NotNil(t, payload["tools"])
		writer.Header().Set("Content-Type", "application/json")
		_, err := writer.Write([]byte(responseBody))
		require.NoError(t, err)
	}))
	defer server.Close()
	answer, err := chatWithProvider(context.Background(), server.Client(), model.AIProviderProfile{Provider: provider, BaseURL: server.URL, DefaultModel: "model"}, "secret", aiChatInput{System: "system", Prompt: "prompt", NativeSearch: true})
	require.NoError(t, err)
	assert.Contains(t, answer, "search")
}

func TestProviderFallbackClassification(t *testing.T) {
	assert.True(t, canFallbackAI(&aiProviderError{status: http.StatusTooManyRequests, err: assert.AnError}))
	assert.True(t, canFallbackAI(&aiProviderError{status: http.StatusBadGateway, err: assert.AnError}))
	assert.False(t, canFallbackAI(&aiProviderError{status: http.StatusUnauthorized, err: assert.AnError}))
	assert.False(t, canFallbackAI(assert.AnError))
}

func TestProviderDefaultsAndValidation(t *testing.T) {
	assert.Equal(t, "https://api.openai.com/v1", providerBaseURL(model.AIProviderProfile{}))
	assert.Equal(t, "https://api.anthropic.com", providerBaseURL(model.AIProviderProfile{Provider: model.AIProviderAnthropic}))
	assert.Equal(t, "https://generativelanguage.googleapis.com", providerBaseURL(model.AIProviderProfile{Provider: model.AIProviderGemini}))
	assert.Equal(t, "http://127.0.0.1:11434", providerBaseURL(model.AIProviderProfile{Provider: model.AIProviderOllama}))
	assert.Error(t, validateProviderURL(model.AIProviderProfile{BaseURL: "://bad"}))
	assert.NoError(t, validateProviderURL(model.AIProviderProfile{BaseURL: "http://localhost:11434"}))
	_, err := chatWithProvider(context.Background(), http.DefaultClient, model.AIProviderProfile{Provider: "unknown", BaseURL: "https://example.com"}, "", aiChatInput{})
	assert.ErrorContains(t, err, "unsupported")
	providerErr := &aiProviderError{status: 500, err: assert.AnError}
	assert.Equal(t, assert.AnError.Error(), providerErr.Error())
	assert.ErrorIs(t, providerErr, assert.AnError)
}

func TestProviderResponseErrors(t *testing.T) {
	tests := []struct {
		name     string
		provider model.AIProviderType
		response string
	}{
		{name: "openai empty", provider: model.AIProviderOpenAICompatible, response: `{"choices":[]}`},
		{name: "anthropic empty", provider: model.AIProviderAnthropic, response: `{"content":[]}`},
		{name: "gemini empty", provider: model.AIProviderGemini, response: `{"candidates":[]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { _, _ = writer.Write([]byte(test.response)) }))
			t.Cleanup(server.Close)
			_, err := chatWithProvider(context.Background(), server.Client(), model.AIProviderProfile{Provider: test.provider, BaseURL: server.URL, DefaultModel: "model"}, "secret", aiChatInput{})
			assert.Error(t, err)
		})
	}
}

func TestPostJSONTransportAndDecodeErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/status" {
			writer.WriteHeader(http.StatusUnauthorized)
			_, _ = writer.Write([]byte("denied"))
			return
		}
		_, _ = writer.Write([]byte("not-json"))
	}))
	t.Cleanup(server.Close)
	assert.ErrorContains(t, postJSON(context.Background(), server.Client(), server.URL+"/status", "", "", map[string]string{}, &map[string]any{}), "401")
	assert.ErrorContains(t, postJSON(context.Background(), server.Client(), server.URL+"/decode", "", "", map[string]string{}, &map[string]any{}), "decode")
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("offline") })}
	assert.ErrorContains(t, postJSON(context.Background(), client, "https://example.com", "", "", map[string]string{}, &map[string]any{}), "offline")
}

func TestNativeSearchFallbackOutputAndUnsupportedProvider(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"output":[{"content":[{"text":"joined"}]}]}`))
	}))
	t.Cleanup(server.Close)
	answer, err := chatOpenAINativeSearch(context.Background(), server.Client(), model.AIProviderProfile{Provider: model.AIProviderOpenAICompatible, BaseURL: server.URL, DefaultModel: "model"}, "secret", aiChatInput{})
	require.NoError(t, err)
	assert.Equal(t, "joined", answer)
	_, err = chatNativeSearch(context.Background(), server.Client(), model.AIProviderProfile{Provider: model.AIProviderOllama, BaseURL: server.URL}, "", aiChatInput{})
	assert.ErrorContains(t, err, "does not support")
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }
