package service

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestAIServiceModelsDevCatalog(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		assert.Equal(t, http.MethodGet, request.Method)
		assert.Equal(t, "application/json", request.Header.Get("Accept"))
		_, err := writer.Write([]byte(modelsDevFixture))
		require.NoError(t, err)
	}))
	t.Cleanup(server.Close)
	service := NewAIService(testutil.NewTestDB(t), nil, nil, testutil.NewTestLogger())
	service.modelsDevURL = server.URL
	service.httpClient = server.Client()

	catalog, err := service.ModelsDevCatalog(false)
	require.NoError(t, err)
	require.Len(t, catalog.Providers, 4)
	assert.Equal(t, []string{"anthropic", "google", "openai", "openrouter"}, catalogProviderIDs(catalog))
	openAI := catalogProvider(t, catalog, "openai")
	assert.Equal(t, model.AIProviderOpenAICompatible, openAI.Provider)
	assert.Equal(t, "https://api.openai.com/v1", openAI.BaseURL)
	require.Len(t, openAI.Models, 1)
	assert.Equal(t, "gpt-text", openAI.Models[0].ID)
	assert.Equal(t, 128000, openAI.Models[0].ContextWindowSize)
	assert.Equal(t, 8192, openAI.Models[0].MaxTokens)
	require.NotNil(t, openAI.Models[0].TemperatureSupported)
	assert.True(t, *openAI.Models[0].TemperatureSupported)

	_, err = service.ModelsDevCatalog(false)
	require.NoError(t, err)
	assert.Equal(t, int32(1), requests.Load(), "cached catalog should avoid another request")
	_, err = service.ModelsDevCatalog(true)
	require.NoError(t, err)
	assert.Equal(t, int32(2), requests.Load(), "refresh should bypass the cache")
}

func TestAIServiceModelsDevCatalogErrors(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		body       string
	}{
		{name: "upstream status", statusCode: http.StatusBadGateway, body: `{}`},
		{name: "invalid json", statusCode: http.StatusOK, body: `{`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.statusCode)
				_, err := writer.Write([]byte(test.body))
				require.NoError(t, err)
			}))
			t.Cleanup(server.Close)
			service := NewAIService(testutil.NewTestDB(t), nil, nil, testutil.NewTestLogger())
			service.modelsDevURL = server.URL
			service.httpClient = server.Client()

			_, err := service.ModelsDevCatalog(false)
			require.Error(t, err)
		})
	}
}

func TestAIServiceModelsDevCatalogRejectsInvalidEndpoint(t *testing.T) {
	service := NewAIService(testutil.NewTestDB(t), nil, nil, testutil.NewTestLogger())
	service.modelsDevURL = ":"
	_, err := service.ModelsDevCatalog(false)
	require.ErrorContains(t, err, "create models.dev request")
}

func TestBuildModelsDevCatalogFallbacksAndValidation(t *testing.T) {
	payload := map[string]modelsDevProviderPayload{
		"compatible": {
			Name: "Compatible", NPM: "@ai-sdk/openai-compatible", API: "https://example.com/v1/",
			Models: map[string]modelsDevModelPayload{
				"z-model": modelsDevTextModel("", "Same Name"),
				"a-model": modelsDevTextModel("", "Same Name"),
			},
		},
		"missing-name": {NPM: "@ai-sdk/openai-compatible", API: "https://example.com/v1"},
		"empty":        {ID: "empty", Name: "Empty", NPM: "@ai-sdk/openai-compatible", API: "https://empty.example/v1"},
	}
	catalog := buildModelsDevCatalog(payload, time.Unix(1, 0))
	require.Len(t, catalog.Providers, 1)
	provider := catalog.Providers[0]
	assert.Equal(t, "compatible", provider.ID)
	assert.Equal(t, "https://example.com/v1", provider.BaseURL)
	require.Len(t, provider.Models, 2)
	assert.Equal(t, []string{"a-model", "z-model"}, []string{provider.Models[0].ID, provider.Models[1].ID})
}

func TestBuildModelsDevModelValidation(t *testing.T) {
	valid := modelsDevTextModel("", "Fallback")
	valid.Temperature = boolPointer(false)
	item, ok := buildModelsDevModel("fallback-id", valid)
	require.True(t, ok)
	assert.Equal(t, "fallback-id", item.ID)
	require.NotNil(t, item.TemperatureSupported)
	assert.False(t, *item.TemperatureSupported)

	_, ok = buildModelsDevModel("", modelsDevTextModel("", "No ID"))
	assert.False(t, ok)
	_, ok = buildModelsDevModel("model", modelsDevTextModel("model", ""))
	assert.False(t, ok)
}

func modelsDevTextModel(id, name string) modelsDevModelPayload {
	entry := modelsDevModelPayload{ID: id, Name: name}
	entry.Modalities.Output = []string{"text"}
	return entry
}

func boolPointer(value bool) *bool { return &value }

func catalogProviderIDs(catalog model.ModelsDevCatalog) []string {
	ids := make([]string, 0, len(catalog.Providers))
	for _, provider := range catalog.Providers {
		ids = append(ids, provider.ID)
	}
	return ids
}

func catalogProvider(t *testing.T, catalog model.ModelsDevCatalog, id string) model.ModelsDevProvider {
	t.Helper()
	for _, provider := range catalog.Providers {
		if provider.ID == id {
			return provider
		}
	}
	t.Fatalf("provider %s not found", id)
	return model.ModelsDevProvider{}
}

const modelsDevFixture = `{
  "openai": {"id":"openai","name":"OpenAI","npm":"@ai-sdk/openai","models":{
    "gpt-text": {"id":"gpt-text","name":"GPT Text","description":"chat","reasoning":false,"temperature":true,"status":"beta","modalities":{"input":["text"],"output":["text"]},"limit":{"context":128000,"output":8192}},
    "gpt-image": {"id":"gpt-image","name":"GPT Image","description":"image","reasoning":false,"modalities":{"input":["text"],"output":["image"]},"limit":{"context":1000,"output":1000}},
    "gpt-old": {"id":"gpt-old","name":"GPT Old","description":"old","reasoning":false,"status":"deprecated","modalities":{"input":["text"],"output":["text"]},"limit":{"context":1000,"output":1000}}
  }},
  "anthropic": {"id":"anthropic","name":"Anthropic","npm":"@ai-sdk/anthropic","models":{"claude":{"id":"claude","name":"Claude","description":"chat","reasoning":true,"modalities":{"input":["text"],"output":["text"]},"limit":{"context":200000,"output":32000}}}},
  "google": {"id":"google","name":"Google","npm":"@ai-sdk/google","models":{"gemini":{"id":"gemini","name":"Gemini","description":"chat","reasoning":true,"modalities":{"input":["text"],"output":["text"]},"limit":{"context":1000000,"output":64000}}}},
  "openrouter": {"id":"openrouter","name":"OpenRouter","npm":"@openrouter/ai-sdk-provider","api":"https://openrouter.ai/api/v1","models":{"vendor/model":{"id":"vendor/model","name":"Vendor Model","description":"chat","reasoning":false,"modalities":{"input":["text"],"output":["text"]},"limit":{"context":64000,"output":4096}}}},
  "unsupported": {"id":"unsupported","name":"Unsupported","npm":"@ai-sdk/unsupported","models":{"model":{"id":"model","name":"Model","description":"chat","reasoning":false,"modalities":{"input":["text"],"output":["text"]},"limit":{"context":1000,"output":1000}}}}
}`
