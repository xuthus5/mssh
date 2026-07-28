package service

import (
	"errors"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

var errAIProviderUnavailable = errors.New("AI provider is unavailable")

type aiProviderSecretSnapshot struct {
	account     string
	value       string
	exists      bool
	sessionOnly bool
}

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
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	profile, err := store.GetAIProviderProfile(s.db, id)
	if err != nil {
		return nil, "", err
	}
	if profile == nil || !profile.Enabled {
		return nil, "", fmt.Errorf("%w: AI provider %d", errAIProviderUnavailable, id)
	}
	secret, _, err := s.secrets.get(providerSecretAccount(id))
	if err != nil {
		return nil, "", fmt.Errorf("%w: read AI provider %d credential: %v", errAIProviderUnavailable, id, err)
	}
	if profile.Provider != model.AIProviderOllama && secret == "" {
		return nil, "", fmt.Errorf("%w: AI provider %d has no API key", errAIProviderUnavailable, id)
	}
	return profile, secret, nil
}

func (s *AIService) restoreProviderSecret(snapshot aiProviderSecretSnapshot, deleteErr error) error {
	if !snapshot.exists {
		return deleteErr
	}
	persisted := s.secrets.set(snapshot.account, snapshot.value)
	if snapshot.sessionOnly || persisted {
		return deleteErr
	}
	restoreErr := errors.New("AI provider credential was restored for the current session only; re-save the API key before restarting")
	s.logger.Error("restore AI provider credential persistently failed", "account", snapshot.account, "error", restoreErr)
	return errors.Join(deleteErr, restoreErr)
}
