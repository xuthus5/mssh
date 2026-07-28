package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *AIService) validateAIProviderPriorities(settings model.AISettings) error {
	if settings.DefaultProviderID != nil && settings.FallbackProviderID != nil && *settings.DefaultProviderID == *settings.FallbackProviderID {
		return fmt.Errorf("default and fallback AI providers must be different")
	}
	if err := s.validateAIProviderPriority("default", settings.DefaultProviderID); err != nil {
		return err
	}
	return s.validateAIProviderPriority("fallback", settings.FallbackProviderID)
}

func (s *AIService) validateAIProviderPriority(name string, id *int64) error {
	if id == nil {
		return nil
	}
	profile, err := store.GetAIProviderProfile(s.db, *id)
	if err != nil {
		return fmt.Errorf("load %s AI provider: %w", name, err)
	}
	if profile == nil {
		return fmt.Errorf("%s AI provider %d not found", name, *id)
	}
	if !profile.Enabled {
		return fmt.Errorf("%s AI provider %d is disabled", name, *id)
	}
	return nil
}

func (s *AIService) ensureProviderCanBeDisabled(input model.AIProviderProfileInput) error {
	if input.ID == 0 || input.Enabled {
		return nil
	}
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return err
	}
	if providerIDMatches(settings.DefaultProviderID, input.ID) {
		return fmt.Errorf("AI provider %d is the default provider and cannot be disabled", input.ID)
	}
	if providerIDMatches(settings.FallbackProviderID, input.ID) {
		return fmt.Errorf("AI provider %d is the fallback provider and cannot be disabled", input.ID)
	}
	return nil
}

func providerIDMatches(current *int64, id int64) bool {
	return current != nil && *current == id
}
