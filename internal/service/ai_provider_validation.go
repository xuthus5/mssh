package service

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
)

func validateAIProviderFields(input model.AIProviderProfileInput) error {
	if strings.ContainsRune(input.Name, 0) || strings.ContainsRune(input.DefaultModel, 0) || strings.ContainsRune(input.BaseURL, 0) {
		return errors.New("AI provider fields must not contain NUL")
	}
	if utf8.RuneCountInString(input.Name) > maxAIProviderNameRunes {
		return fmt.Errorf("provider name must not exceed %d characters", maxAIProviderNameRunes)
	}
	if utf8.RuneCountInString(input.DefaultModel) > maxAIProviderModelRunes {
		return fmt.Errorf("default model must not exceed %d characters", maxAIProviderModelRunes)
	}
	if len(input.BaseURL) > maxAIProviderURLBytes {
		return fmt.Errorf("provider URL must not exceed %d bytes", maxAIProviderURLBytes)
	}
	if len(input.APIKey) > maxAIProviderAPIKeyBytes {
		return fmt.Errorf("API key exceeds size limit")
	}
	switch input.Provider {
	case model.AIProviderOpenAICompatible, model.AIProviderAnthropic, model.AIProviderGemini, model.AIProviderOllama:
	default:
		return fmt.Errorf("unsupported AI provider %s", input.Provider)
	}
	return validateAIProviderAdvancedFields(input)
}

func validateAIProviderAdvancedFields(input model.AIProviderProfileInput) error {
	if input.ContextWindowSize < 0 || input.ContextWindowSize > maxAIContextWindowSize {
		return fmt.Errorf("context window size must be between 0 and %d", maxAIContextWindowSize)
	}
	if input.MaxTokens < 0 || input.MaxTokens > maxAIMaxTokens {
		return fmt.Errorf("max tokens must be between 0 and %d", maxAIMaxTokens)
	}
	if err := validateAIProviderFloat(input.Temperature, 0, 2, "temperature"); err != nil {
		return err
	}
	if err := validateAIProviderFloat(input.TopP, 0, 1, "top_p"); err != nil {
		return err
	}
	if err := validateAIProviderFloat(input.FrequencyPenalty, -2, 2, "frequency_penalty"); err != nil {
		return err
	}
	if err := validateAIProviderFloat(input.PresencePenalty, -2, 2, "presence_penalty"); err != nil {
		return err
	}
	if len(input.CustomHeaders) > maxAICustomHeaderCount {
		return fmt.Errorf("custom headers must not exceed %d entries", maxAICustomHeaderCount)
	}
	for key := range input.CustomHeaders {
		if isReservedAIHeader(key) {
			return fmt.Errorf("custom header %q is reserved", key)
		}
		if utf8.RuneCountInString(key) > maxAICustomHeaderKeyRunes {
			return fmt.Errorf("custom header key must not exceed %d characters", maxAICustomHeaderKeyRunes)
		}
	}
	return nil
}

func isReservedAIHeader(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "authorization", "cookie", "set-cookie", "x-api-key", "x-goog-api-key", "anthropic-version":
		return true
	default:
		return false
	}
}

func validateAIProviderFloat(value *float64, min, max float64, name string) error {
	if value == nil {
		return nil
	}
	if *value < min || *value > max {
		return fmt.Errorf("%s must be between %g and %g", name, min, max)
	}
	return nil
}
