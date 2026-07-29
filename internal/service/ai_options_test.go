package service

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/netproxy"
)

func TestNewAIServiceAppliesOptions(t *testing.T) {
	manager := netproxy.New()
	dataDir := t.TempDir()
	service := NewAIService(
		nil,
		nil,
		nil,
		nil,
		WithAIProxy(manager),
		WithAIModelsDevDataDir(dataDir),
	)

	require.NotNil(t, service.httpClient)
	assert.Equal(t, 45*time.Second, service.httpClient.Timeout)
	assert.Same(t, manager, service.httpClient.Transport)
	assert.Equal(t, filepath.Join(dataDir, modelsDevCacheFilename), service.modelsDevCachePath)
}

func TestNewAIServiceUsesDefaultsForEmptyOptions(t *testing.T) {
	service := NewAIService(nil, nil, nil, nil, nil, WithAIModelsDevDataDir(""))

	require.NotNil(t, service.httpClient)
	assert.Equal(t, 45*time.Second, service.httpClient.Timeout)
	assert.Empty(t, service.modelsDevCachePath)
}
