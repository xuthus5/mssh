package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

func chatNativeSearch(ctx context.Context, client *http.Client, profile model.AIProviderProfile, apiKey string, input aiChatInput) (string, error) {
	switch profile.Provider {
	case model.AIProviderOpenAICompatible:
		return chatOpenAINativeSearch(ctx, client, profile, apiKey, input)
	case model.AIProviderAnthropic:
		return chatAnthropicNativeSearch(ctx, client, profile, apiKey, input)
	case model.AIProviderGemini:
		return chatGeminiNativeSearch(ctx, client, profile, apiKey, input)
	default:
		return "", errors.New("current AI provider does not support native web search")
	}
}

func chatOpenAINativeSearch(ctx context.Context, client *http.Client, profile model.AIProviderProfile, apiKey string, input aiChatInput) (string, error) {
	payload := map[string]any{"model": profile.DefaultModel, "instructions": input.System, "input": userAIContent(input), "tools": []map[string]any{{"type": "web_search_preview"}}}
	var response struct {
		OutputText string `json:"output_text"`
		Output     []struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := postJSON(ctx, client, providerBaseURL(profile)+"/responses", apiKey, "", payload, &response); err != nil {
		return "", err
	}
	if response.OutputText != "" {
		return response.OutputText, nil
	}
	return joinNativeOutput(response.Output), nil
}

func chatAnthropicNativeSearch(ctx context.Context, client *http.Client, profile model.AIProviderProfile, apiKey string, input aiChatInput) (string, error) {
	payload := map[string]any{"model": profile.DefaultModel, "max_tokens": 4096, "system": input.System, "messages": []map[string]string{{"role": "user", "content": userAIContent(input)}}, "tools": []map[string]any{{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}}}
	var response struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := postJSON(ctx, client, providerBaseURL(profile)+"/v1/messages", apiKey, "anthropic", payload, &response); err != nil {
		return "", err
	}
	parts := make([]string, 0, len(response.Content))
	for _, item := range response.Content {
		if item.Type == "text" && item.Text != "" {
			parts = append(parts, item.Text)
		}
	}
	return strings.Join(parts, "\n"), nil
}

func chatGeminiNativeSearch(ctx context.Context, client *http.Client, profile model.AIProviderProfile, apiKey string, input aiChatInput) (string, error) {
	endpoint := fmt.Sprintf("%s/v1beta/models/%s:generateContent?key=%s", providerBaseURL(profile), url.PathEscape(profile.DefaultModel), url.QueryEscape(apiKey))
	payload := map[string]any{"systemInstruction": map[string]any{"parts": []map[string]string{{"text": input.System}}}, "contents": []map[string]any{{"parts": []map[string]string{{"text": userAIContent(input)}}}}, "tools": []map[string]any{{"google_search": map[string]any{}}}}
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
		return "", errors.New("AI provider returned no grounded content")
	}
	return response.Candidates[0].Content.Parts[0].Text, nil
}

func userAIContent(input aiChatInput) string {
	return input.Prompt + "\n\n终端上下文:\n" + input.Context
}

func joinNativeOutput(output []struct {
	Content []struct {
		Text string `json:"text"`
	} `json:"content"`
}) string {
	parts := make([]string, 0)
	for _, item := range output {
		for _, content := range item.Content {
			if content.Text != "" {
				parts = append(parts, content.Text)
			}
		}
	}
	return strings.Join(parts, "\n")
}
