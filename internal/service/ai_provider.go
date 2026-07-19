package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

type aiChatInput struct {
	System       string
	Prompt       string
	Context      string
	NativeSearch bool
}

type aiProviderError struct {
	status int
	err    error
}

func (e *aiProviderError) Error() string { return e.err.Error() }

func (e *aiProviderError) Unwrap() error { return e.err }

func chatWithProvider(ctx context.Context, client *http.Client, profile model.AIProviderProfile, apiKey string, input aiChatInput) (string, error) {
	if err := validateProviderURL(profile); err != nil {
		return "", err
	}
	if input.NativeSearch {
		return chatNativeSearch(ctx, client, profile, apiKey, input)
	}
	switch profile.Provider {
	case model.AIProviderOpenAICompatible:
		return chatOpenAI(ctx, client, profile, apiKey, input)
	case model.AIProviderAnthropic:
		return chatAnthropic(ctx, client, profile, apiKey, input)
	case model.AIProviderGemini:
		return chatGemini(ctx, client, profile, apiKey, input)
	case model.AIProviderOllama:
		return chatOllama(ctx, client, profile, input)
	default:
		return "", fmt.Errorf("unsupported AI provider %s", profile.Provider)
	}
}

func validateProviderURL(profile model.AIProviderProfile) error {
	base := providerBaseURL(profile)
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("invalid AI provider URL")
	}
	if parsed.Scheme != "https" && !isLocalProviderHost(parsed.Hostname()) {
		return fmt.Errorf("AI provider URL must use HTTPS unless it is local")
	}
	return nil
}

func providerBaseURL(profile model.AIProviderProfile) string {
	if profile.BaseURL != "" {
		return strings.TrimRight(profile.BaseURL, "/")
	}
	switch profile.Provider {
	case model.AIProviderAnthropic:
		return "https://api.anthropic.com"
	case model.AIProviderGemini:
		return "https://generativelanguage.googleapis.com"
	case model.AIProviderOllama:
		return "http://127.0.0.1:11434"
	default:
		return "https://api.openai.com/v1"
	}
}

func isLocalProviderHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func chatOpenAI(ctx context.Context, client *http.Client, profile model.AIProviderProfile, apiKey string, input aiChatInput) (string, error) {
	payload := map[string]any{"model": profile.DefaultModel, "stream": false, "messages": []map[string]string{{"role": "system", "content": input.System}, {"role": "user", "content": input.Prompt + "\n\n终端上下文:\n" + input.Context}}}
	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	err := postJSON(ctx, client, providerBaseURL(profile)+"/chat/completions", apiKey, "", payload, &response)
	if err != nil {
		return "", err
	}
	if len(response.Choices) == 0 {
		return "", errors.New("AI provider returned no choices")
	}
	return response.Choices[0].Message.Content, nil
}

func chatAnthropic(ctx context.Context, client *http.Client, profile model.AIProviderProfile, apiKey string, input aiChatInput) (string, error) {
	payload := map[string]any{"model": profile.DefaultModel, "max_tokens": 4096, "system": input.System, "messages": []map[string]string{{"role": "user", "content": input.Prompt + "\n\n终端上下文:\n" + input.Context}}}
	var response struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	err := postJSON(ctx, client, providerBaseURL(profile)+"/v1/messages", apiKey, "anthropic", payload, &response)
	if err != nil {
		return "", err
	}
	if len(response.Content) == 0 {
		return "", errors.New("AI provider returned no content")
	}
	return response.Content[0].Text, nil
}

func chatGemini(ctx context.Context, client *http.Client, profile model.AIProviderProfile, apiKey string, input aiChatInput) (string, error) {
	endpoint := fmt.Sprintf("%s/v1beta/models/%s:generateContent?key=%s", providerBaseURL(profile), url.PathEscape(profile.DefaultModel), url.QueryEscape(apiKey))
	payload := map[string]any{"systemInstruction": map[string]any{"parts": []map[string]string{{"text": input.System}}}, "contents": []map[string]any{{"parts": []map[string]string{{"text": input.Prompt + "\n\n终端上下文:\n" + input.Context}}}}}
	var response struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := postJSON(ctx, client, endpoint, "", "", payload, &response); err != nil {
		return "", err
	}
	if len(response.Candidates) == 0 || len(response.Candidates[0].Content.Parts) == 0 {
		return "", errors.New("AI provider returned no candidates")
	}
	return response.Candidates[0].Content.Parts[0].Text, nil
}

func chatOllama(ctx context.Context, client *http.Client, profile model.AIProviderProfile, input aiChatInput) (string, error) {
	payload := map[string]any{"model": profile.DefaultModel, "stream": false, "messages": []map[string]string{{"role": "system", "content": input.System}, {"role": "user", "content": input.Prompt + "\n\n终端上下文:\n" + input.Context}}}
	var response struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := postJSON(ctx, client, providerBaseURL(profile)+"/api/chat", "", "", payload, &response); err != nil {
		return "", err
	}
	return response.Message.Content, nil
}

func postJSON(ctx context.Context, client *http.Client, endpoint, apiKey, kind string, payload any, output any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode AI request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create AI request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		if kind == "anthropic" {
			request.Header.Set("x-api-key", apiKey)
			request.Header.Set("anthropic-version", "2023-06-01")
		} else {
			request.Header.Set("Authorization", "Bearer "+apiKey)
		}
	}
	response, err := client.Do(request)
	if err != nil {
		return &aiProviderError{err: fmt.Errorf("AI request failed: %w", err)}
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, readErr := io.ReadAll(io.LimitReader(response.Body, 16*1024))
		if readErr != nil {
			return &aiProviderError{status: response.StatusCode, err: fmt.Errorf("AI provider returned HTTP %d: %w", response.StatusCode, readErr)}
		}
		return &aiProviderError{status: response.StatusCode, err: fmt.Errorf("AI provider returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(message)))}
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 4*1024*1024))
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("decode AI response: %w", err)
	}
	return nil
}
