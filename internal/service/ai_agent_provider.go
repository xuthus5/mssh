package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

type aiAgentProviderRequest struct {
	Client  *http.Client
	Profile model.AIProviderProfile
	APIKey  string
	Input   aiChatInput
}

func (s *AIService) requestAIAgentAction(ctx context.Context, settings model.AISettings, input aiChatInput) (aiAgentAction, string, error) {
	ids := providerOrder(settings)
	if len(ids) == 0 {
		return aiAgentAction{}, "", errors.New("no AI provider is configured")
	}
	var lastErr error
	for index, id := range ids {
		action, raw, err := s.requestAIAgentProviderAction(ctx, id, input)
		if err == nil {
			return action, raw, nil
		}
		lastErr = err
		if ctx.Err() != nil {
			return aiAgentAction{}, "", fmt.Errorf("AI request canceled: %w", ctx.Err())
		}
		if index == len(ids)-1 || !canFallbackAI(err) {
			break
		}
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "ai_provider_fallback", TargetType: "ai_provider", TargetID: fmt.Sprint(id), Summary: "AI Agent 提供商故障切换", Outcome: "success"})
	}
	return aiAgentAction{}, "", fmt.Errorf("AI agent request failed: %w", lastErr)
}

func (s *AIService) requestAIAgentProviderAction(ctx context.Context, providerID int64, input aiChatInput) (aiAgentAction, string, error) {
	profile, secret, err := s.loadProvider(providerID)
	if err != nil {
		return aiAgentAction{}, "", err
	}
	requestCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	request := aiAgentProviderRequest{Client: s.httpClient, Profile: *profile, APIKey: secret, Input: input}
	action, raw, err := requestNativeAIAgentAction(requestCtx, request)
	if err == nil || !isAIAgentNativeUnsupported(err) {
		return action, raw, err
	}
	answer, fallbackErr := chatWithProvider(requestCtx, s.httpClient, *profile, secret, input)
	if fallbackErr != nil {
		return aiAgentAction{}, "", fallbackErr
	}
	action, fallbackErr = parseAIAgentAction(answer)
	return action, answer, fallbackErr
}

func requestNativeAIAgentAction(ctx context.Context, request aiAgentProviderRequest) (aiAgentAction, string, error) {
	if err := validateProviderURL(request.Profile); err != nil {
		return aiAgentAction{}, "", err
	}
	request.Client = providerHTTPClient(request.Client, request.Profile.SkipTLSVerify)
	switch request.Profile.Provider {
	case model.AIProviderOpenAICompatible:
		return requestOpenAIAgentAction(ctx, request)
	case model.AIProviderAnthropic:
		return requestAnthropicAgentAction(ctx, request)
	case model.AIProviderGemini:
		return requestGeminiAgentAction(ctx, request)
	case model.AIProviderOllama:
		return requestOllamaAgentAction(ctx, request)
	default:
		return aiAgentAction{}, "", fmt.Errorf("unsupported AI provider %s", request.Profile.Provider)
	}
}

func requestOpenAIAgentAction(ctx context.Context, request aiAgentProviderRequest) (aiAgentAction, string, error) {
	payload := map[string]any{"model": request.Profile.DefaultModel, "stream": false, "messages": agentOpenAIMessages(request.Input), "tools": openAIAgentTools()}
	applyOpenAIParams(payload, request.Profile)
	var response struct {
		Choices []struct {
			Message struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}
	err := postJSON(ctx, request.Client, providerBaseURL(request.Profile)+"/chat/completions", request.APIKey, "", request.Profile.CustomHeaders, payload, &response)
	if err != nil {
		return aiAgentAction{}, "", err
	}
	if len(response.Choices) == 0 {
		return aiAgentAction{}, "", fmt.Errorf("%w: no choices", errAIProviderProtocol)
	}
	message := response.Choices[0].Message
	if len(message.ToolCalls) == 0 {
		return parseAIAgentTextFallback(message.Content)
	}
	call := message.ToolCalls[0].Function
	return newNativeAIAgentAction(call.Name, json.RawMessage(call.Arguments), message.Content)
}

func requestAnthropicAgentAction(ctx context.Context, request aiAgentProviderRequest) (aiAgentAction, string, error) {
	payload := map[string]any{"model": request.Profile.DefaultModel, "max_tokens": agentMaxTokens(request.Profile), "system": request.Input.System, "messages": []map[string]string{{"role": "user", "content": request.Input.Prompt}}, "tools": anthropicAIAgentTools()}
	var response struct {
		Content []struct {
			Type  string          `json:"type"`
			Text  string          `json:"text"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
	}
	err := postJSON(ctx, request.Client, providerBaseURL(request.Profile)+"/v1/messages", request.APIKey, "anthropic", request.Profile.CustomHeaders, payload, &response)
	if err != nil {
		return aiAgentAction{}, "", err
	}
	text := agentAnthropicText(response.Content)
	for _, item := range response.Content {
		if item.Type == "tool_use" {
			return newNativeAIAgentAction(item.Name, item.Input, text)
		}
	}
	return parseAIAgentTextFallback(text)
}

func requestGeminiAgentAction(ctx context.Context, request aiAgentProviderRequest) (aiAgentAction, string, error) {
	endpoint := fmt.Sprintf("%s/v1beta/models/%s:generateContent", providerBaseURL(request.Profile), url.PathEscape(request.Profile.DefaultModel))
	payload := map[string]any{"systemInstruction": map[string]any{"parts": []map[string]string{{"text": request.Input.System}}}, "contents": []map[string]any{{"parts": []map[string]string{{"text": request.Input.Prompt}}}}, "tools": []map[string]any{{"functionDeclarations": geminiAIAgentTools()}}}
	applyGeminiParams(payload, request.Profile)
	var response struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text         string `json:"text"`
					FunctionCall *struct {
						Name string          `json:"name"`
						Args json.RawMessage `json:"args"`
					} `json:"functionCall"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := postJSON(ctx, request.Client, endpoint, request.APIKey, "gemini", request.Profile.CustomHeaders, payload, &response); err != nil {
		return aiAgentAction{}, "", err
	}
	if len(response.Candidates) == 0 {
		return aiAgentAction{}, "", fmt.Errorf("%w: no candidates", errAIProviderProtocol)
	}
	parts := response.Candidates[0].Content.Parts
	text := agentGeminiText(parts)
	for _, part := range parts {
		if part.FunctionCall != nil {
			return newNativeAIAgentAction(part.FunctionCall.Name, part.FunctionCall.Args, text)
		}
	}
	return parseAIAgentTextFallback(text)
}

func requestOllamaAgentAction(ctx context.Context, request aiAgentProviderRequest) (aiAgentAction, string, error) {
	payload := map[string]any{"model": request.Profile.DefaultModel, "stream": false, "messages": agentOpenAIMessages(request.Input), "tools": openAIAgentTools()}
	applyOllamaParams(payload, request.Profile)
	var response struct {
		Message struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				Function struct {
					Name      string          `json:"name"`
					Arguments json.RawMessage `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"message"`
	}
	if err := postJSON(ctx, request.Client, providerBaseURL(request.Profile)+"/api/chat", "", "", request.Profile.CustomHeaders, payload, &response); err != nil {
		return aiAgentAction{}, "", err
	}
	if len(response.Message.ToolCalls) == 0 {
		return parseAIAgentTextFallback(response.Message.Content)
	}
	call := response.Message.ToolCalls[0].Function
	return newNativeAIAgentAction(call.Name, call.Arguments, response.Message.Content)
}

func parseAIAgentTextFallback(text string) (aiAgentAction, string, error) {
	action, err := parseAIAgentAction(text)
	if err != nil {
		return aiAgentAction{}, "", fmt.Errorf("%w: no usable tool call: %v", errAIProviderProtocol, err)
	}
	return action, text, nil
}

func newNativeAIAgentAction(name string, arguments json.RawMessage, reason string) (aiAgentAction, string, error) {
	tool, ok := nativeAIAgentToolName(name)
	if !ok || len(arguments) == 0 {
		return aiAgentAction{}, "", fmt.Errorf("%w: invalid tool call", errAIProviderProtocol)
	}
	action := aiAgentAction{Tool: tool, Arguments: arguments, Reason: reason}
	raw, err := json.Marshal(action)
	if err != nil {
		return aiAgentAction{}, "", fmt.Errorf("encode AI agent action: %w", err)
	}
	return action, string(raw), nil
}

func isAIAgentNativeUnsupported(err error) bool {
	if errors.Is(err, errAIProviderProtocol) {
		return true
	}
	var providerErr *aiProviderError
	if !errors.As(err, &providerErr) {
		return false
	}
	switch providerErr.status {
	case http.StatusBadRequest, http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusUnprocessableEntity, http.StatusNotImplemented:
		return true
	default:
		return false
	}
}
