package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"

	"github.com/xuthus5/mssh/internal/fsutil"
	"github.com/xuthus5/mssh/internal/model"
)

const (
	modelsDevCacheFormatVersion = 1
	modelsDevCacheTempPattern   = ".models-dev-catalog-*.tmp"
	maxModelsDevProviders       = 1024
	maxModelsDevModels          = 20000
)

type modelsDevCacheFile struct {
	FormatVersion int                    `json:"format_version"`
	Catalog       model.ModelsDevCatalog `json:"catalog"`
}

func readModelsDevCatalogCache(path string) (catalog model.ModelsDevCatalog, err error) {
	if path == "" {
		return model.ModelsDevCatalog{}, os.ErrNotExist
	}
	file, _, err := fsutil.OpenRegularFile(path)
	if err != nil {
		return model.ModelsDevCatalog{}, fmt.Errorf("open models.dev cache: %w", err)
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close models.dev cache: %w", closeErr))
		}
	}()
	var cache modelsDevCacheFile
	if err := decodeBoundedJSON(file, maxModelsDevResponseBytes, &cache); err != nil {
		return model.ModelsDevCatalog{}, fmt.Errorf("decode models.dev cache: %w", err)
	}
	if cache.FormatVersion != modelsDevCacheFormatVersion {
		return model.ModelsDevCatalog{}, fmt.Errorf("unsupported models.dev cache format %d", cache.FormatVersion)
	}
	if err := validateModelsDevCatalogCache(cache.Catalog); err != nil {
		return model.ModelsDevCatalog{}, fmt.Errorf("validate models.dev cache: %w", err)
	}
	return cache.Catalog, nil
}

func writeModelsDevCatalogCache(path string, catalog model.ModelsDevCatalog) error {
	if path == "" {
		return nil
	}
	if err := validateModelsDevCatalogCache(catalog); err != nil {
		return fmt.Errorf("validate models.dev catalog before caching: %w", err)
	}
	content, err := json.Marshal(modelsDevCacheFile{FormatVersion: modelsDevCacheFormatVersion, Catalog: catalog})
	if err != nil {
		return fmt.Errorf("encode models.dev cache: %w", err)
	}
	if err := fsutil.WritePrivateFileAtomic(path, content, modelsDevCacheTempPattern); err != nil {
		return fmt.Errorf("write models.dev cache: %w", err)
	}
	return nil
}

func validateModelsDevCatalogCache(catalog model.ModelsDevCatalog) error {
	if catalog.CachedAt.IsZero() || len(catalog.Providers) == 0 || len(catalog.Providers) > maxModelsDevProviders {
		return errors.New("catalog metadata is invalid")
	}
	modelCount := 0
	for _, provider := range catalog.Providers {
		if err := validateModelsDevCachedProvider(provider); err != nil {
			return err
		}
		modelCount += len(provider.Models)
		if modelCount > maxModelsDevModels {
			return errors.New("catalog contains too many models")
		}
	}
	return nil
}

func validateModelsDevCachedProvider(provider model.ModelsDevProvider) error {
	if provider.ID == "" || provider.Name == "" || len(provider.Models) == 0 {
		return errors.New("catalog provider is incomplete")
	}
	if provider.Provider != model.AIProviderOpenAICompatible && provider.Provider != model.AIProviderAnthropic && provider.Provider != model.AIProviderGemini {
		return fmt.Errorf("catalog provider %s uses an unsupported protocol", provider.ID)
	}
	endpoint, err := url.Parse(provider.BaseURL)
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" {
		return fmt.Errorf("catalog provider %s has an invalid base URL", provider.ID)
	}
	for _, catalogModel := range provider.Models {
		if catalogModel.ID == "" || catalogModel.Name == "" || catalogModel.ContextWindowSize < 0 || catalogModel.MaxTokens < 0 {
			return fmt.Errorf("catalog provider %s contains an invalid model", provider.ID)
		}
	}
	return nil
}
