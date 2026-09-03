package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSaveProviderPersistsAdvancedFields(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	temp := 0.7
	topP := 0.9
	freq := 1.5
	pres := 0.3
	profile, err := service.SaveProvider(model.AIProviderProfileInput{
		Name: "adv", Provider: model.AIProviderOpenAICompatible,
		BaseURL: "https://api.openai.com/v1", DefaultModel: "gpt-4o", Enabled: true,
		ContextWindowSize: 128000, SkipTLSVerify: true, MaxTokens: 2048,
		Temperature: &temp, TopP: &topP, FrequencyPenalty: &freq, PresencePenalty: &pres,
		CustomHeaders: map[string]string{"X-Custom-Header": "value-1"},
	})
	require.NoError(t, err)
	require.NotNil(t, profile)
	assert.Equal(t, 128000, profile.ContextWindowSize)
	assert.True(t, profile.SkipTLSVerify)
	assert.Equal(t, 2048, profile.MaxTokens)
	require.NotNil(t, profile.Temperature)
	assert.InDelta(t, 0.7, *profile.Temperature, 0.001)
	require.NotNil(t, profile.TopP)
	assert.InDelta(t, 0.9, *profile.TopP, 0.001)
	require.NotNil(t, profile.FrequencyPenalty)
	assert.InDelta(t, 1.5, *profile.FrequencyPenalty, 0.001)
	require.NotNil(t, profile.PresencePenalty)
	assert.InDelta(t, 0.3, *profile.PresencePenalty, 0.001)
	assert.Equal(t, "value-1", profile.CustomHeaders["X-Custom-Header"])
}

func TestValidateAIProviderRejectsCredentialHeaders(t *testing.T) {
	for _, header := range []string{"Authorization", "x-api-key", "X-Goog-Api-Key", "Anthropic-Version", "Cookie"} {
		err := validateAIProviderFields(model.AIProviderProfileInput{Provider: model.AIProviderOpenAICompatible, CustomHeaders: map[string]string{header: "secret"}})
		assert.ErrorContains(t, err, "reserved")
	}
}

func TestValidateAIProviderAdvancedFields(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	tooHigh := 3.0
	_, err := service.SaveProvider(model.AIProviderProfileInput{
		Name: "v", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://api.openai.com/v1", DefaultModel: "m", Temperature: &tooHigh,
	})
	assert.ErrorContains(t, err, "temperature")
	tooLow := -3.0
	_, err = service.SaveProvider(model.AIProviderProfileInput{
		Name: "v", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://api.openai.com/v1", DefaultModel: "m", FrequencyPenalty: &tooLow,
	})
	assert.ErrorContains(t, err, "frequency_penalty")
	overTopP := 1.5
	_, err = service.SaveProvider(model.AIProviderProfileInput{
		Name: "v", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://api.openai.com/v1", DefaultModel: "m", TopP: &overTopP,
	})
	assert.ErrorContains(t, err, "top_p")
	_, err = service.SaveProvider(model.AIProviderProfileInput{
		Name: "v", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://api.openai.com/v1", DefaultModel: "m", MaxTokens: 1 << 30,
	})
	assert.ErrorContains(t, err, "max tokens")
}

func TestProviderHTTPClientSkipTLSVerify(t *testing.T) {
	base := sharedHTTPClient(5_000_000_000, nil)
	skip := providerHTTPClient(base, true)
	assert.NotSame(t, base, skip)
	transport, ok := skip.Transport.(*http.Transport)
	require.True(t, ok)
	assert.True(t, transport.TLSClientConfig.InsecureSkipVerify)
	same := providerHTTPClient(base, false)
	assert.Same(t, base, same)
}

func TestProviderHTTPClientSkipTLSVerifyPreservesProxyManager(t *testing.T) {
	manager := netproxy.New()
	require.NoError(t, manager.Configure(netproxy.Config{Mode: netproxy.ModeManual, URL: "http://127.0.0.1:8080"}))
	base := sharedHTTPClient(5_000_000_000, manager)

	skip := providerHTTPClient(base, true)

	transport, ok := skip.Transport.(*http.Transport)
	require.True(t, ok)
	require.True(t, transport.TLSClientConfig.InsecureSkipVerify)
	require.NotNil(t, transport.Proxy)
	request := httptest.NewRequest(http.MethodGet, "http://example.com/", nil)
	proxyURL, err := transport.Proxy(request)
	require.NoError(t, err)
	require.Equal(t, "http://127.0.0.1:8080", proxyURL.String())
}

func TestProviderHTTPClientSkipTLSVerifyKeepsUnknownTransportSafe(t *testing.T) {
	base := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("stop") })}
	skip := providerHTTPClient(base, true)
	assert.IsType(t, base.Transport, skip.Transport)
}
