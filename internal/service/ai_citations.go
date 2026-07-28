package service

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

var aiCitationMarkerPattern = regexp.MustCompile(`\[(\d{1,4})\]`)

var errAICitationPolicy = errors.New("AI citation policy rejected response")

const maxAICitationURLBytes = 4096

func prepareAICitationPolicy(request model.AIChatRequest, settings model.AISettings, citations []model.AICitation) (string, error) {
	if !requiresAICitations(request, settings) {
		return aiSystemPrompt, nil
	}
	if settings.Search.Mode == model.AISearchNative {
		return "", fmt.Errorf("native search cannot provide verified citations")
	}
	validCitations := filterValidAICitations(citations)
	if len(validCitations) == 0 {
		return "", fmt.Errorf("AI search returned no citations while citations are required")
	}
	return fmt.Sprintf(
		"%s\n网络搜索结果已编号为 [1] 到 [%d]。回答中使用网络搜索信息时，必须在相关句末标注至少一个有效来源编号，不得编造范围外编号。",
		aiSystemPrompt,
		len(validCitations),
	), nil
}

func requiresAICitations(request model.AIChatRequest, settings model.AISettings) bool {
	return request.UseSearch &&
		settings.Search.Enabled &&
		settings.Search.Mode != model.AISearchDisabled &&
		settings.Search.RequireCitations
}

func validateRequiredAICitations(answer string, citationCount int) error {
	valid := false
	for _, match := range aiCitationMarkerPattern.FindAllStringSubmatch(answer, -1) {
		index, err := strconv.Atoi(match[1])
		if err != nil || index < 1 || index > citationCount {
			return fmt.Errorf("AI answer included an invalid citation %s", match[0])
		}
		valid = true
	}
	if valid {
		return nil
	}
	return fmt.Errorf("AI answer did not include a valid citation")
}

func validateAIProviderAnswer(input aiChatInput, answer string) error {
	if strings.TrimSpace(answer) == "" {
		return fmt.Errorf("%w: answer content is empty", errAIProviderProtocol)
	}
	if input.RequiredCitationCount == 0 {
		return nil
	}
	if err := validateRequiredAICitations(answer, input.RequiredCitationCount); err != nil {
		return fmt.Errorf("%w: %v", errAICitationPolicy, err)
	}
	return nil
}

func filterValidAICitations(citations []model.AICitation) []model.AICitation {
	result := make([]model.AICitation, 0, len(citations))
	seen := make(map[string]struct{}, len(citations))
	for _, citation := range citations {
		rawURL := strings.TrimSpace(citation.URL)
		if rawURL == "" || len(rawURL) > maxAICitationURLBytes {
			continue
		}
		parsed, err := url.Parse(rawURL)
		if err != nil || parsed.User != nil || parsed.Hostname() == "" {
			continue
		}
		scheme := strings.ToLower(parsed.Scheme)
		if scheme != "http" && scheme != "https" {
			continue
		}
		normalized := parsed.String()
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		citation.Title = strings.TrimSpace(citation.Title)
		citation.URL = normalized
		citation.Snippet = strings.TrimSpace(citation.Snippet)
		result = append(result, citation)
	}
	return result
}
