package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestModelsDevCatalogCacheFileErrors(t *testing.T) {
	catalog := validModelsDevCacheCatalog()
	require.NoError(t, writeModelsDevCatalogCache("", catalog))
	_, err := readModelsDevCatalogCache("")
	assert.ErrorIs(t, err, os.ErrNotExist)

	directory := t.TempDir()
	_, err = readModelsDevCatalogCache(directory)
	assert.ErrorContains(t, err, "open models.dev cache")

	cachePath := filepath.Join(directory, "catalog.json")
	writeModelsDevCacheFixture(t, cachePath, modelsDevCacheFile{FormatVersion: 99, Catalog: catalog})
	_, err = readModelsDevCatalogCache(cachePath)
	assert.ErrorContains(t, err, "unsupported models.dev cache format")

	writeModelsDevCacheFixture(t, cachePath, modelsDevCacheFile{FormatVersion: modelsDevCacheFormatVersion})
	_, err = readModelsDevCatalogCache(cachePath)
	assert.ErrorContains(t, err, "validate models.dev cache")

	err = writeModelsDevCatalogCache(cachePath, model.ModelsDevCatalog{})
	assert.ErrorContains(t, err, "validate models.dev catalog before caching")
}

func TestValidateModelsDevCatalogCacheErrors(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*model.ModelsDevCatalog)
		match  string
	}{
		{name: "metadata", mutate: func(catalog *model.ModelsDevCatalog) { catalog.CachedAt = time.Time{} }, match: "metadata"},
		{name: "provider incomplete", mutate: func(catalog *model.ModelsDevCatalog) { catalog.Providers[0].Name = "" }, match: "incomplete"},
		{name: "protocol", mutate: func(catalog *model.ModelsDevCatalog) { catalog.Providers[0].Provider = model.AIProviderOllama }, match: "unsupported protocol"},
		{name: "base URL scheme", mutate: func(catalog *model.ModelsDevCatalog) { catalog.Providers[0].BaseURL = "ftp://example.com" }, match: "invalid base URL"},
		{name: "base URL host", mutate: func(catalog *model.ModelsDevCatalog) { catalog.Providers[0].BaseURL = "http://" }, match: "invalid base URL"},
		{name: "base URL credentials", mutate: func(catalog *model.ModelsDevCatalog) { catalog.Providers[0].BaseURL = "https://user:pass@example.com" }, match: "invalid base URL"},
		{name: "model", mutate: func(catalog *model.ModelsDevCatalog) { catalog.Providers[0].Models[0].ID = "" }, match: "invalid model"},
		{name: "model count", mutate: addExcessModels, match: "too many models"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			catalog := validModelsDevCacheCatalog()
			test.mutate(&catalog)
			assert.ErrorContains(t, validateModelsDevCatalogCache(catalog), test.match)
		})
	}
}

func TestValidateModelsDevCatalogCacheAcceptsLocalHTTPProvider(t *testing.T) {
	catalog := validModelsDevCacheCatalog()
	catalog.Providers[0] = model.ModelsDevProvider{
		ID: "atomic-chat", Name: "Atomic Chat", Provider: model.AIProviderOpenAICompatible,
		BaseURL: "http://127.0.0.1:1337/v1", Models: []model.ModelsDevModel{{ID: "model", Name: "Model"}},
	}
	require.NoError(t, validateModelsDevCatalogCache(catalog))
}

func validModelsDevCacheCatalog() model.ModelsDevCatalog {
	return model.ModelsDevCatalog{CachedAt: time.Unix(1, 0).UTC(), Providers: []model.ModelsDevProvider{{
		ID: "openai", Name: "OpenAI", Provider: model.AIProviderOpenAICompatible,
		BaseURL: "https://api.openai.com/v1", Models: []model.ModelsDevModel{{ID: "gpt", Name: "GPT"}},
	}}}
}

func addExcessModels(catalog *model.ModelsDevCatalog) {
	modelTemplate := catalog.Providers[0].Models[0]
	catalog.Providers[0].Models = make([]model.ModelsDevModel, maxModelsDevModels+1)
	for index := range catalog.Providers[0].Models {
		catalog.Providers[0].Models[index] = modelTemplate
	}
}

func writeModelsDevCacheFixture(t *testing.T, path string, cache modelsDevCacheFile) {
	t.Helper()
	content, err := json.Marshal(cache)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, content, 0o600))
}

func TestReadModelsDevCatalogCacheReturnsValidCatalog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalog.json")
	expected := validModelsDevCacheCatalog()
	writeModelsDevCacheFixture(t, path, modelsDevCacheFile{FormatVersion: modelsDevCacheFormatVersion, Catalog: expected})

	actual, err := readModelsDevCatalogCache(path)
	require.NoError(t, err)
	assert.Equal(t, expected, actual)
}

func TestWriteModelsDevCatalogCacheRejectsNonexistentParent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing", "catalog.json")
	err := writeModelsDevCatalogCache(path, validModelsDevCacheCatalog())
	require.Error(t, err)
	assert.False(t, errors.Is(err, os.ErrExist))
}
