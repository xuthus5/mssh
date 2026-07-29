package service

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	modelsDevAPIURL           = "https://models.dev/api.json"
	modelsDevCacheTTL         = 6 * time.Hour
	maxModelsDevResponseBytes = 32 * 1024 * 1024
)

type modelsDevProviderPayload struct {
	ID     string                           `json:"id"`
	Name   string                           `json:"name"`
	NPM    string                           `json:"npm"`
	API    string                           `json:"api"`
	Models map[string]modelsDevModelPayload `json:"models"`
}

type modelsDevModelPayload struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Reasoning   bool   `json:"reasoning"`
	Temperature *bool  `json:"temperature"`
	Status      string `json:"status"`
	Modalities  struct {
		Output []string `json:"output"`
	} `json:"modalities"`
	Limit struct {
		Context int `json:"context"`
		Output  int `json:"output"`
	} `json:"limit"`
}

// ModelsDevCatalog returns models.dev entries compatible with MSSH's provider protocols.
func (s *AIService) ModelsDevCatalog(refresh bool) (model.ModelsDevCatalog, error) {
	ctx, finish, err := s.beginOperation()
	if err != nil {
		return model.ModelsDevCatalog{}, err
	}
	defer finish()

	s.modelsDevMu.Lock()
	defer s.modelsDevMu.Unlock()
	if !refresh && !s.modelsDevCache.CachedAt.IsZero() && time.Since(s.modelsDevCache.CachedAt) < modelsDevCacheTTL {
		return cloneModelsDevCatalog(s.modelsDevCache), nil
	}
	catalog, err := s.fetchModelsDevCatalog(ctx)
	if err != nil {
		return model.ModelsDevCatalog{}, err
	}
	s.modelsDevCache = catalog
	return cloneModelsDevCatalog(catalog), nil
}

func (s *AIService) fetchModelsDevCatalog(ctx context.Context) (model.ModelsDevCatalog, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.modelsDevURL, nil)
	if err != nil {
		return model.ModelsDevCatalog{}, fmt.Errorf("create models.dev request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	response, err := sameOriginHTTPClient(s.httpClient, request.URL).Do(request)
	if err != nil {
		return model.ModelsDevCatalog{}, fmt.Errorf("request models.dev catalog: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return model.ModelsDevCatalog{}, fmt.Errorf("models.dev returned HTTP %d", response.StatusCode)
	}
	payload := make(map[string]modelsDevProviderPayload)
	if err := decodeBoundedJSON(response.Body, maxModelsDevResponseBytes, &payload); err != nil {
		return model.ModelsDevCatalog{}, fmt.Errorf("decode models.dev catalog: %w", err)
	}
	return buildModelsDevCatalog(payload, time.Now().UTC()), nil
}

func buildModelsDevCatalog(payload map[string]modelsDevProviderPayload, cachedAt time.Time) model.ModelsDevCatalog {
	providers := make([]model.ModelsDevProvider, 0, len(payload))
	for key, entry := range payload {
		provider, ok := buildModelsDevProvider(key, entry)
		if ok && len(provider.Models) > 0 {
			providers = append(providers, provider)
		}
	}
	sort.Slice(providers, func(left, right int) bool { return providers[left].ID < providers[right].ID })
	return model.ModelsDevCatalog{Providers: providers, CachedAt: cachedAt}
}

func buildModelsDevProvider(key string, entry modelsDevProviderPayload) (model.ModelsDevProvider, bool) {
	providerType, baseURL, ok := modelsDevProviderRoute(key, entry)
	if !ok {
		return model.ModelsDevProvider{}, false
	}
	id := strings.TrimSpace(entry.ID)
	if id == "" {
		id = strings.TrimSpace(key)
	}
	name := strings.TrimSpace(entry.Name)
	if id == "" || name == "" {
		return model.ModelsDevProvider{}, false
	}
	provider := model.ModelsDevProvider{ID: id, Name: name, Provider: providerType, BaseURL: baseURL}
	for modelKey, entryModel := range entry.Models {
		if item, supported := buildModelsDevModel(modelKey, entryModel); supported {
			provider.Models = append(provider.Models, item)
		}
	}
	sort.Slice(provider.Models, func(left, right int) bool {
		if provider.Models[left].Name == provider.Models[right].Name {
			return provider.Models[left].ID < provider.Models[right].ID
		}
		return provider.Models[left].Name < provider.Models[right].Name
	})
	return provider, true
}

func modelsDevProviderRoute(key string, entry modelsDevProviderPayload) (model.AIProviderType, string, bool) {
	id := strings.TrimSpace(entry.ID)
	if id == "" {
		id = strings.TrimSpace(key)
	}
	switch id {
	case "openai":
		return model.AIProviderOpenAICompatible, "https://api.openai.com/v1", true
	case "anthropic":
		return model.AIProviderAnthropic, "https://api.anthropic.com", true
	case "google":
		return model.AIProviderGemini, "https://generativelanguage.googleapis.com", true
	}
	api := strings.TrimRight(strings.TrimSpace(entry.API), "/")
	compatible := entry.NPM == "@ai-sdk/openai-compatible" || entry.NPM == "@openrouter/ai-sdk-provider"
	return model.AIProviderOpenAICompatible, api, compatible && api != ""
}

func buildModelsDevModel(key string, entry modelsDevModelPayload) (model.ModelsDevModel, bool) {
	id := strings.TrimSpace(entry.ID)
	if id == "" {
		id = strings.TrimSpace(key)
	}
	name := strings.TrimSpace(entry.Name)
	if id == "" || name == "" || entry.Status == "deprecated" || !containsString(entry.Modalities.Output, "text") {
		return model.ModelsDevModel{}, false
	}
	return model.ModelsDevModel{
		ID: id, Name: name, Description: strings.TrimSpace(entry.Description),
		ContextWindowSize: entry.Limit.Context, MaxTokens: entry.Limit.Output,
		Reasoning: entry.Reasoning, TemperatureSupported: entry.Temperature, Status: entry.Status,
	}, true
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func cloneModelsDevCatalog(catalog model.ModelsDevCatalog) model.ModelsDevCatalog {
	cloned := model.ModelsDevCatalog{CachedAt: catalog.CachedAt, Providers: make([]model.ModelsDevProvider, len(catalog.Providers))}
	for index, provider := range catalog.Providers {
		cloned.Providers[index] = provider
		cloned.Providers[index].Models = append([]model.ModelsDevModel(nil), provider.Models...)
	}
	return cloned
}
