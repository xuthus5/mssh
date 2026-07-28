package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestAIServiceChatRejectsOversizedPromptBeforeProviderRequest(t *testing.T) {
	database := testutil.NewTestDB(t)
	session := createAIServiceSession(t, database)
	service := NewAIService(database, nil, nil, testutil.NewTestLogger())
	service.terminals = &aiTerminalStub{sessionID: session.ID}

	_, err := service.Chat(model.AIChatRequest{
		SessionID: session.ID, TerminalID: "term", Prompt: strings.Repeat("p", maxAIChatPromptBytes+1),
	})

	require.Error(t, err)
	assert.ErrorContains(t, err, "prompt exceeds")
}

func TestAIServiceChatRejectsOversizedRawTerminalContext(t *testing.T) {
	database := testutil.NewTestDB(t)
	session := createAIServiceSession(t, database)
	service := NewAIService(database, nil, nil, testutil.NewTestLogger())
	service.terminals = &aiTerminalStub{sessionID: session.ID}

	_, err := service.Chat(model.AIChatRequest{
		SessionID: session.ID, TerminalID: "term", Prompt: "inspect",
		TerminalContext: strings.Repeat("x", maxAIChatContextBytes+1),
	})

	require.Error(t, err)
	assert.ErrorContains(t, err, "terminal context exceeds")
}

func TestAIServiceSaveSettingsRejectsOversizedSearchCredential(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewAIService(database, nil, nil, testutil.NewTestLogger())
	input := aiSettingsInput(defaultAISettings())
	input.Search.APIKey = strings.Repeat("k", maxAISearchAPIKeyBytes+1)

	err := service.SaveSettings(input)

	require.Error(t, err)
	assert.ErrorContains(t, err, "search API key")
}

func TestAIServiceSaveSettingsRejectsExcessiveRegexPatterns(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewAIService(database, nil, nil, testutil.NewTestLogger())
	input := aiSettingsInput(defaultAISettings())
	input.Security.AllowPatterns = repeatedAIRegexPatterns(maxAIRegexPatternsPerCategory + 1)

	err := service.SaveSettings(input)

	require.Error(t, err)
	assert.ErrorContains(t, err, "allow patterns")

	input = aiSettingsInput(defaultAISettings())
	input.Security.AllowPatterns = repeatedAIRegexPatterns(maxAIRegexPatternsTotal / 2)
	input.Security.DenyPatterns = repeatedAIRegexPatterns(maxAIRegexPatternsTotal / 2)
	input.Security.RedactionPatterns = []string{"extra"}

	err = service.SaveSettings(input)

	require.Error(t, err)
	assert.ErrorContains(t, err, "regular expression pattern count")
}

func TestAIResourceLimitsAcceptBoundaryValues(t *testing.T) {
	request := model.AIChatRequest{
		Prompt:          strings.Repeat("p", maxAIChatPromptBytes),
		TerminalContext: strings.Repeat("x", maxAIChatContextBytes),
	}
	require.NoError(t, validateAIChatRequestSize(request))
	require.NoError(t, validateAISearchAPIKey(strings.Repeat("k", maxAISearchAPIKeyBytes)))

	settings := defaultAISettings().Security
	settings.AllowPatterns = repeatedAIRegexPatterns(maxAIRegexPatternsPerCategory)
	settings.DenyPatterns = repeatedAIRegexPatterns(maxAIRegexPatternsTotal - maxAIRegexPatternsPerCategory)
	require.NoError(t, validateAIRegexSettings(settings))
}

func repeatedAIRegexPatterns(count int) []string {
	patterns := make([]string, count)
	for index := range patterns {
		patterns[index] = "^command-" + strings.Repeat("x", index%8) + "$"
	}
	return patterns
}
