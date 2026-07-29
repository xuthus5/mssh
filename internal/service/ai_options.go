package service

import (
	"path/filepath"
	"time"

	"github.com/xuthus5/mssh/internal/netproxy"
)

const modelsDevCacheFilename = "models-dev-catalog.json"

type AIServiceOption func(*AIService)

func WithAIProxy(manager *netproxy.Manager) AIServiceOption {
	return func(service *AIService) {
		service.httpClient = sharedHTTPClient(45*time.Second, manager)
	}
}

func WithAIModelsDevDataDir(dataDir string) AIServiceOption {
	return func(service *AIService) {
		if dataDir != "" {
			service.modelsDevCachePath = filepath.Join(dataDir, modelsDevCacheFilename)
		}
	}
}
