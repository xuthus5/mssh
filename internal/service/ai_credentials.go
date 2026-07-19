package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *AIService) providerSecretState(id int64) (bool, bool, error) {
	account := providerSecretAccount(id)
	s.secrets.mu.RLock()
	_, sessionOnly := s.secrets.volatile[account]
	s.secrets.mu.RUnlock()
	_, saved, err := s.secrets.get(account)
	return saved, sessionOnly, err
}

func (s *AIService) enrichSearchSecretState(settings *model.AISettings) {
	account := searchSecretAccount(settings.Search.Provider)
	s.secrets.mu.RLock()
	_, sessionOnly := s.secrets.volatile[account]
	s.secrets.mu.RUnlock()
	_, saved, err := s.secrets.get(account)
	if err != nil {
		s.logger.Warn("read AI search credential state failed", "provider", settings.Search.Provider, "error", err)
	}
	settings.Search.CredentialSaved = saved
	settings.Search.CredentialSessionOnly = sessionOnly
}

func (s *AIService) loadProvider(id int64) (*model.AIProviderProfile, string, error) {
	profile, err := store.GetAIProviderProfile(s.db, id)
	if err != nil {
		return nil, "", err
	}
	if profile == nil || !profile.Enabled {
		return nil, "", fmt.Errorf("AI provider %d is unavailable", id)
	}
	secret, _, err := s.secrets.get(providerSecretAccount(id))
	if err != nil {
		return nil, "", err
	}
	if profile.Provider != model.AIProviderOllama && secret == "" {
		return nil, "", fmt.Errorf("AI provider %d has no API key", id)
	}
	return profile, secret, nil
}
