package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestNativeAIAgentProviderToolCalls(t *testing.T) {
	tests := []struct {
		name     string
		provider model.AIProviderType
		path     string
		response string
	}{
		{name: "openai", provider: model.AIProviderOpenAICompatible, path: "/chat/completions", response: `{"choices":[{"message":{"content":"inspect","tool_calls":[{"function":{"name":"ssh_exec","arguments":"{\"command\":\"pwd\"}"}}]}}]}`},
		{name: "anthropic", provider: model.AIProviderAnthropic, path: "/v1/messages", response: `{"content":[{"type":"text","text":"inspect"},{"type":"tool_use","name":"ssh_exec","input":{"command":"pwd"}}]}`},
		{name: "gemini", provider: model.AIProviderGemini, path: "/v1beta/models/model:generateContent", response: `{"candidates":[{"content":{"parts":[{"text":"inspect"},{"functionCall":{"name":"ssh_exec","args":{"command":"pwd"}}}]}}]}`},
		{name: "ollama", provider: model.AIProviderOllama, path: "/api/chat", response: `{"message":{"content":"inspect","tool_calls":[{"function":{"name":"ssh_exec","arguments":{"command":"pwd"}}}]}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			testNativeAIAgentProvider(t, test.provider, test.path, test.response)
		})
	}
}

func testNativeAIAgentProvider(t *testing.T, provider model.AIProviderType, expectedPath, responseBody string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, expectedPath, request.URL.Path)
		var payload map[string]any
		require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
		assert.NotNil(t, payload["tools"])
		_, err := writer.Write([]byte(responseBody))
		require.NoError(t, err)
	}))
	t.Cleanup(server.Close)
	request := aiAgentProviderRequest{Client: server.Client(), Profile: model.AIProviderProfile{Provider: provider, BaseURL: server.URL, DefaultModel: "model"}, APIKey: "secret", Input: aiChatInput{System: "system", Prompt: "prompt"}}
	action, raw, err := requestNativeAIAgentAction(context.Background(), request)
	require.NoError(t, err)
	assert.Equal(t, "ssh.exec", action.Tool)
	assert.JSONEq(t, `{"command":"pwd"}`, string(action.Arguments))
	assert.Contains(t, raw, "ssh.exec")
}

func TestNativeAIAgentTextAndUnsupportedFallback(t *testing.T) {
	action, raw, err := parseAIAgentTextFallback(`{"tool":"task.finish","arguments":{"result":"done"},"reason":"ok"}`)
	require.NoError(t, err)
	assert.Equal(t, "task.finish", action.Tool)
	assert.NotEmpty(t, raw)

	_, _, err = parseAIAgentTextFallback("plain text")
	assert.ErrorIs(t, err, errAIProviderProtocol)
	assert.True(t, isAIAgentNativeUnsupported(err))
	assert.True(t, isAIAgentNativeUnsupported(&aiProviderError{status: http.StatusBadRequest, err: assert.AnError}))
	assert.False(t, isAIAgentNativeUnsupported(&aiProviderError{status: http.StatusUnauthorized, err: assert.AnError}))
}

func TestNativeAIAgentRejectsUnknownTool(t *testing.T) {
	_, _, err := newNativeAIAgentAction("local_shell", json.RawMessage(`{}`), "")
	assert.ErrorIs(t, err, errAIProviderProtocol)
}
