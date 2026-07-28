package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAIServiceRejectsInvalidSettingsReferencesAndEnums(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	enabled := saveAISettingsTestProvider(t, service, "enabled", true)
	disabled := saveAISettingsTestProvider(t, service, "disabled", false)
	tests := []struct {
		name        string
		mutate      func(*model.AISettingsInput)
		expectError string
	}{
		{name: "unknown search mode", mutate: func(input *model.AISettingsInput) { input.Search.Mode = "unknown" }, expectError: "search mode"},
		{name: "unknown search provider", mutate: func(input *model.AISettingsInput) { input.Search.Provider = "unknown" }, expectError: "search provider"},
		{name: "missing default provider", mutate: func(input *model.AISettingsInput) { id := int64(999); input.DefaultProviderID = &id }, expectError: "not found"},
		{name: "disabled default provider", mutate: func(input *model.AISettingsInput) { input.DefaultProviderID = &disabled.ID }, expectError: "disabled"},
		{name: "duplicate priorities", mutate: func(input *model.AISettingsInput) {
			input.DefaultProviderID = &enabled.ID
			input.FallbackProviderID = &enabled.ID
		}, expectError: "must be different"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := aiSettingsInput(defaultAISettings())
			test.mutate(&input)
			assert.ErrorContains(t, service.SaveSettings(input), test.expectError)
		})
	}
}

func TestAIServiceDoesNotChangeSearchSecretWhenSettingsFail(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.secrets.set(searchSecretAccount(model.AISearchProviderBrave), "old-secret")
	input := aiSettingsInput(defaultAISettings())
	missingID := int64(999)
	input.DefaultProviderID = &missingID
	input.Search.APIKey = "new-secret"
	require.Error(t, service.SaveSettings(input))
	secret, exists, err := service.secrets.get(searchSecretAccount(model.AISearchProviderBrave))
	require.NoError(t, err)
	assert.True(t, exists)
	assert.Equal(t, "old-secret", secret)
}

func TestAIServiceRejectsDisablingReferencedProvider(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	provider := saveAISettingsTestProvider(t, service, "main", true)
	input := aiSettingsInput(defaultAISettings())
	input.DefaultProviderID = &provider.ID
	require.NoError(t, service.SaveSettings(input))
	_, err := service.SaveProvider(model.AIProviderProfileInput{
		ID: provider.ID, Name: provider.Name, Provider: provider.Provider,
		BaseURL: provider.BaseURL, DefaultModel: provider.DefaultModel, Enabled: false,
	})
	assert.ErrorContains(t, err, "default provider")
	stored, loadErr := store.GetAIProviderProfile(db, provider.ID)
	require.NoError(t, loadErr)
	require.NotNil(t, stored)
	assert.True(t, stored.Enabled)
}

func saveAISettingsTestProvider(t *testing.T, service *AIService, name string, enabled bool) *model.AIProviderProfile {
	t.Helper()
	provider, err := service.SaveProvider(model.AIProviderProfileInput{
		Name: name, Provider: model.AIProviderOllama, BaseURL: "http://127.0.0.1:11434",
		DefaultModel: "model", Enabled: enabled,
	})
	require.NoError(t, err)
	return provider
}
