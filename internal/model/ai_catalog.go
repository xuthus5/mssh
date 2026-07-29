package model

import "time"

// ModelsDevCatalog is the supported subset of the models.dev catalog.
type ModelsDevCatalog struct {
	Providers []ModelsDevProvider `json:"providers"`
	CachedAt  time.Time           `json:"cached_at"`
}

// ModelsDevProvider describes a models.dev provider that MSSH can call.
type ModelsDevProvider struct {
	ID       string           `json:"id"`
	Name     string           `json:"name"`
	Provider AIProviderType   `json:"provider"`
	BaseURL  string           `json:"base_url"`
	Models   []ModelsDevModel `json:"models"`
}

// ModelsDevModel contains the model defaults used by the provider editor.
type ModelsDevModel struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	Description          string `json:"description"`
	ContextWindowSize    int    `json:"context_window_size"`
	MaxTokens            int    `json:"max_tokens"`
	Reasoning            bool   `json:"reasoning"`
	TemperatureSupported *bool  `json:"temperature_supported"`
	Status               string `json:"status"`
}
