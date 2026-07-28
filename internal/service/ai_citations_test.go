package service

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestPrepareAICitationPolicy(t *testing.T) {
	settings := defaultAISettings()
	settings.Search.Enabled = true
	settings.Search.Mode = model.AISearchIndependent
	tests := []struct {
		name         string
		request      model.AIChatRequest
		settings     model.AISettings
		citations    []model.AICitation
		expectError  string
		expectPrompt bool
	}{
		{name: "search not requested", request: model.AIChatRequest{}, settings: settings},
		{name: "requirement disabled", request: model.AIChatRequest{UseSearch: true}, settings: withCitationRequirement(settings, false)},
		{name: "missing search results", request: model.AIChatRequest{UseSearch: true}, settings: settings, expectError: "returned no citations"},
		{name: "native search cannot be verified", request: model.AIChatRequest{UseSearch: true}, settings: withSearchMode(settings, model.AISearchNative), expectError: "native search"},
		{name: "valid search results", request: model.AIChatRequest{UseSearch: true}, settings: settings, citations: []model.AICitation{{Title: "Docs", URL: "https://example.com/docs"}}, expectPrompt: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			prompt, err := prepareAICitationPolicy(test.request, test.settings, test.citations)
			if test.expectError != "" {
				require.ErrorContains(t, err, test.expectError)
				return
			}
			require.NoError(t, err)
			if test.expectPrompt {
				assert.Contains(t, prompt, "[1]")
				assert.Contains(t, prompt, "不得编造")
			} else {
				assert.Equal(t, aiSystemPrompt, prompt)
			}
		})
	}
}

func TestValidateRequiredAICitations(t *testing.T) {
	tests := []struct {
		name        string
		answer      string
		count       int
		expectError bool
	}{
		{name: "valid first citation", answer: "结论 [1]", count: 1},
		{name: "valid citation among text", answer: "先说明，再引用 [2]。", count: 2},
		{name: "missing citation", answer: "没有来源", count: 2, expectError: true},
		{name: "out of range citation", answer: "错误来源 [3]", count: 2, expectError: true},
		{name: "mixed valid and out of range citations", answer: "部分有效 [1]，部分伪造 [3]", count: 2, expectError: true},
		{name: "zero is invalid", answer: "错误来源 [0]", count: 2, expectError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateRequiredAICitations(test.answer, test.count)
			if test.expectError {
				assert.ErrorContains(t, err, "valid citation")
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestFilterValidAICitations(t *testing.T) {
	filtered := filterValidAICitations([]model.AICitation{
		{Title: "Docs", URL: "https://example.com/docs", Snippet: "first"},
		{Title: "Duplicate", URL: "https://example.com/docs", Snippet: "second"},
		{Title: "Unsafe", URL: "javascript:alert(1)"},
		{Title: "Missing", URL: ""},
	})

	require.Len(t, filtered, 1)
	assert.Equal(t, "https://example.com/docs", filtered[0].URL)
}

func TestAIServiceCitationRequirementGuardsPersistence(t *testing.T) {
	t.Run("rejects uncited provider answer", func(t *testing.T) {
		harness := newCitationChatHarness(t, `{"web":{"results":[{"title":"Docs","url":"https://example.com","description":"result"}]}}`, "answer", true)
		_, err := harness.service.Chat(harness.request())
		require.ErrorContains(t, err, "valid citation")
		assert.Equal(t, int32(1), harness.providerCalls.Load())
		assertCitationConversationEmpty(t, harness)
	})

	t.Run("allows uncited answer when disabled", func(t *testing.T) {
		harness := newCitationChatHarness(t, `{"web":{"results":[{"title":"Docs","url":"https://example.com","description":"result"}]}}`, "answer", false)
		response, err := harness.service.Chat(harness.request())
		require.NoError(t, err)
		assert.Equal(t, "answer", response.Answer)
		require.Len(t, response.Citations, 1)
	})

	t.Run("rejects empty results before provider call", func(t *testing.T) {
		harness := newCitationChatHarness(t, `{"web":{"results":[]}}`, "answer [1]", true)
		_, err := harness.service.Chat(harness.request())
		require.ErrorContains(t, err, "returned no citations")
		assert.Zero(t, harness.providerCalls.Load())
		assertCitationConversationEmpty(t, harness)
	})
}

func TestAIServiceCitationRequirementFallsBackToValidAnswer(t *testing.T) {
	db := testutil.NewTestDB(t)
	primaryServer := aiTestServer(t, http.StatusOK, `{"choices":[{"message":{"content":"uncited"}}]}`)
	t.Cleanup(primaryServer.Close)
	fallbackServer := aiTestServer(t, http.StatusOK, `{"choices":[{"message":{"content":"cited [1]"}}]}`)
	t.Cleanup(fallbackServer.Close)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	primary, err := service.SaveProvider(model.AIProviderProfileInput{Name: "primary", Provider: model.AIProviderOpenAICompatible, BaseURL: primaryServer.URL, DefaultModel: "model", Enabled: true, APIKey: "one"})
	require.NoError(t, err)
	fallback, err := service.SaveProvider(model.AIProviderProfileInput{Name: "fallback", Provider: model.AIProviderOpenAICompatible, BaseURL: fallbackServer.URL, DefaultModel: "model", Enabled: true, APIKey: "two"})
	require.NoError(t, err)
	settings := defaultAISettings()
	settings.DefaultProviderID = &primary.ID
	settings.FallbackProviderID = &fallback.ID
	answer, providerID, err := service.chatWithFallback(settings, aiChatInput{Prompt: "search", RequiredCitationCount: 1})
	require.NoError(t, err)
	assert.Equal(t, "cited [1]", answer)
	assert.Equal(t, fallback.ID, providerID)
}

type citationChatHarness struct {
	service        *AIService
	db             *sql.DB
	session        *model.Session
	conversationID int64
	providerCalls  *atomic.Int32
}

func newCitationChatHarness(t *testing.T, searchBody, answer string, requireCitations bool) citationChatHarness {
	t.Helper()
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	providerCalls := &atomic.Int32{}
	providerServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		providerCalls.Add(1)
		_, err := writer.Write([]byte(`{"choices":[{"message":{"content":"` + answer + `"}}]}`))
		require.NoError(t, err)
	}))
	t.Cleanup(providerServer.Close)
	searchServer := aiTestServer(t, http.StatusOK, searchBody)
	t.Cleanup(searchServer.Close)
	restoreSearchEndpoint(t, model.AISearchProviderBrave, searchServer.URL)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.httpClient = providerServer.Client()
	provider, err := service.SaveProvider(model.AIProviderProfileInput{Name: "test", Provider: model.AIProviderOpenAICompatible, BaseURL: providerServer.URL, DefaultModel: "model", Enabled: true, APIKey: "secret"})
	require.NoError(t, err)
	settings := defaultAISettings()
	settings.DefaultProviderID = &provider.ID
	settings.Search.Enabled = true
	settings.Search.Mode = model.AISearchIndependent
	settings.Search.RequireCitations = requireCitations
	service.secrets.set(searchSecretAccount(settings.Search.Provider), "search-secret")
	require.NoError(t, store.SaveAISettings(db, settings))
	conversationID, err := store.CreateAIConversation(db, session.ID, "existing")
	require.NoError(t, err)
	return citationChatHarness{service: service, db: db, session: session, conversationID: conversationID, providerCalls: providerCalls}
}

func (h citationChatHarness) request() model.AIChatRequest {
	return model.AIChatRequest{ConversationID: h.conversationID, SessionID: h.session.ID, TerminalID: "term", Prompt: "search", UseSearch: true}
}

func assertCitationConversationEmpty(t *testing.T, harness citationChatHarness) {
	t.Helper()
	messages, err := store.ListAIMessages(harness.db, harness.conversationID)
	require.NoError(t, err)
	assert.Empty(t, messages)
}

func withCitationRequirement(settings model.AISettings, enabled bool) model.AISettings {
	settings.Search.RequireCitations = enabled
	return settings
}

func withSearchMode(settings model.AISettings, mode model.AISearchMode) model.AISettings {
	settings.Search.Mode = mode
	return settings
}
