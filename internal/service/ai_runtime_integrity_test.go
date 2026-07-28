package service

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestValidateAIProviderAnswerRejectsBlankResponses(t *testing.T) {
	err := validateAIProviderAnswer(aiChatInput{}, " \n\t ")
	require.Error(t, err)
	assert.ErrorIs(t, err, errAIProviderProtocol)
}

func TestAIServiceFallsBackOnInvalidProviderResponses(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "blank answer", body: `{"choices":[{"message":{"content":"   "}}]}`},
		{name: "malformed JSON", body: `{"choices":[`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			primaryServer := aiTestServer(t, http.StatusOK, test.body)
			t.Cleanup(primaryServer.Close)
			fallbackServer := aiTestServer(t, http.StatusOK, `{"choices":[{"message":{"content":"fallback"}}]}`)
			t.Cleanup(fallbackServer.Close)
			service := NewAIService(db, nil, nil, testutil.NewTestLogger())
			primary, err := service.SaveProvider(model.AIProviderProfileInput{
				Name: "primary", Provider: model.AIProviderOpenAICompatible,
				BaseURL: primaryServer.URL, DefaultModel: "model", Enabled: true, APIKey: "one",
			})
			require.NoError(t, err)
			fallback, err := service.SaveProvider(model.AIProviderProfileInput{
				Name: "fallback", Provider: model.AIProviderOpenAICompatible,
				BaseURL: fallbackServer.URL, DefaultModel: "model", Enabled: true, APIKey: "two",
			})
			require.NoError(t, err)
			settings := defaultAISettings()
			settings.DefaultProviderID, settings.FallbackProviderID = &primary.ID, &fallback.ID

			answer, providerID, err := service.chatWithFallback(settings, aiChatInput{Prompt: "hello"})
			require.NoError(t, err)
			assert.Equal(t, "fallback", answer)
			assert.Equal(t, fallback.ID, providerID)
		})
	}
}

func TestAIServiceFallsBackWhenPrimaryCredentialIsMissing(t *testing.T) {
	db := testutil.NewTestDB(t)
	fallbackServer := aiTestServer(t, http.StatusOK, `{"choices":[{"message":{"content":"fallback"}}]}`)
	t.Cleanup(fallbackServer.Close)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	primary, err := store.SaveAIProviderProfile(db, model.AIProviderProfileInput{
		Name: "primary", Provider: model.AIProviderOpenAICompatible,
		BaseURL: "https://example.com/v1", DefaultModel: "model", Enabled: true,
	})
	require.NoError(t, err)
	fallback, err := service.SaveProvider(model.AIProviderProfileInput{
		Name: "fallback", Provider: model.AIProviderOpenAICompatible,
		BaseURL: fallbackServer.URL, DefaultModel: "model", Enabled: true, APIKey: "two",
	})
	require.NoError(t, err)
	settings := defaultAISettings()
	settings.DefaultProviderID, settings.FallbackProviderID = &primary.ID, &fallback.ID

	answer, providerID, err := service.chatWithFallback(settings, aiChatInput{Prompt: "hello"})
	require.NoError(t, err)
	assert.Equal(t, "fallback", answer)
	assert.Equal(t, fallback.ID, providerID)
}

func TestAIServiceRequiresNewCredentialWhenProviderRouteChanges(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	provider, err := service.SaveProvider(model.AIProviderProfileInput{
		Name: "primary", Provider: model.AIProviderOpenAICompatible,
		BaseURL: "https://api.example.com/v1", DefaultModel: "model", Enabled: true, APIKey: "old-secret",
	})
	require.NoError(t, err)

	_, err = service.SaveProvider(model.AIProviderProfileInput{
		ID: provider.ID, Name: provider.Name, Provider: provider.Provider,
		BaseURL: "https://other.example.com/v1", DefaultModel: provider.DefaultModel, Enabled: true,
	})
	require.ErrorContains(t, err, "API key")
	stored, err := store.GetAIProviderProfile(db, provider.ID)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, provider.BaseURL, stored.BaseURL)
	secret, exists, err := service.secrets.get(providerSecretAccount(provider.ID))
	require.NoError(t, err)
	assert.True(t, exists)
	assert.Equal(t, "old-secret", secret)
}

func TestAIServiceRequiresCredentialWhenExternalSearchIsEnabled(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	input := aiSettingsInput(defaultAISettings())
	input.Search.Enabled = true
	input.Search.Mode = model.AISearchIndependent

	require.ErrorContains(t, service.SaveSettings(input), "search credential")
	input.Search.APIKey = "search-secret"
	require.NoError(t, service.SaveSettings(input))
}
