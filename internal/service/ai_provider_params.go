package service

import (
	"net/http"

	"github.com/xuthus5/mssh/internal/model"
)

func applyOpenAIParams(payload map[string]any, profile model.AIProviderProfile) {
	if profile.MaxTokens > 0 {
		payload["max_tokens"] = profile.MaxTokens
	}
	if profile.Temperature != nil {
		payload["temperature"] = *profile.Temperature
	}
	if profile.TopP != nil {
		payload["top_p"] = *profile.TopP
	}
	if profile.FrequencyPenalty != nil {
		payload["frequency_penalty"] = *profile.FrequencyPenalty
	}
	if profile.PresencePenalty != nil {
		payload["presence_penalty"] = *profile.PresencePenalty
	}
}

func applyGeminiParams(payload map[string]any, profile model.AIProviderProfile) {
	config := map[string]any{}
	if profile.MaxTokens > 0 {
		config["maxOutputTokens"] = profile.MaxTokens
	}
	if profile.Temperature != nil {
		config["temperature"] = *profile.Temperature
	}
	if profile.TopP != nil {
		config["topP"] = *profile.TopP
	}
	if profile.FrequencyPenalty != nil {
		config["frequencyPenalty"] = *profile.FrequencyPenalty
	}
	if profile.PresencePenalty != nil {
		config["presencePenalty"] = *profile.PresencePenalty
	}
	if len(config) > 0 {
		payload["generationConfig"] = config
	}
}

func applyOllamaParams(payload map[string]any, profile model.AIProviderProfile) {
	options := map[string]any{}
	if profile.Temperature != nil {
		options["temperature"] = *profile.Temperature
	}
	if profile.TopP != nil {
		options["top_p"] = *profile.TopP
	}
	if profile.FrequencyPenalty != nil {
		options["frequency_penalty"] = *profile.FrequencyPenalty
	}
	if profile.PresencePenalty != nil {
		options["presence_penalty"] = *profile.PresencePenalty
	}
	if len(options) > 0 {
		payload["options"] = options
	}
}

func applyCustomHeaders(request *http.Request, headers map[string]string) {
	for key, value := range headers {
		if key == "" {
			continue
		}
		request.Header.Set(key, value)
	}
}
