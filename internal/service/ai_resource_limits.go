package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	maxAIChatPromptBytes          = 64 * 1024
	maxAIChatContextBytes         = 4 * 1024 * 1024
	maxAISearchAPIKeyBytes        = maxAIProviderAPIKeyBytes
	maxAIRegexPatternsPerCategory = 32
	maxAIRegexPatternsTotal       = 64
	maxAIAgentVersionOutputBytes  = 64 * 1024
)

func validateAIChatRequestSize(request model.AIChatRequest) error {
	if len(request.Prompt) > maxAIChatPromptBytes {
		return fmt.Errorf("AI prompt exceeds %d bytes", maxAIChatPromptBytes)
	}
	if len(request.TerminalContext) > maxAIChatContextBytes {
		return fmt.Errorf("AI terminal context exceeds %d bytes", maxAIChatContextBytes)
	}
	return nil
}

func validateAISearchAPIKey(apiKey string) error {
	if len(apiKey) > maxAISearchAPIKeyBytes {
		return fmt.Errorf("AI search API key exceeds %d bytes", maxAISearchAPIKeyBytes)
	}
	return nil
}

func validateAIRegexPatternCounts(settings model.AISecuritySettings) error {
	collections := []struct {
		name     string
		patterns []string
	}{
		{name: "allow", patterns: settings.AllowPatterns},
		{name: "deny", patterns: settings.DenyPatterns},
		{name: "redaction", patterns: settings.RedactionPatterns},
	}
	total := 0
	for _, collection := range collections {
		if len(collection.patterns) > maxAIRegexPatternsPerCategory {
			return fmt.Errorf("AI %s patterns must not exceed %d", collection.name, maxAIRegexPatternsPerCategory)
		}
		total += len(collection.patterns)
	}
	if total > maxAIRegexPatternsTotal {
		return fmt.Errorf("AI regular expression pattern count must not exceed %d", maxAIRegexPatternsTotal)
	}
	return nil
}
