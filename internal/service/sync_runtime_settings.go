package service

import "fmt"

// SyncRuntimeSettings reapplies process-local settings after synchronized data is restored.
type SyncRuntimeSettings interface {
	ApplyStoredProxySettings() error
	ApplyStoredProxySettingsWithinCryptoOperation() error
}

func (s *SyncService) applyRestoredProxySettings() error {
	if s.runtimeSettings == nil {
		return nil
	}
	if err := s.runtimeSettings.ApplyStoredProxySettings(); err != nil {
		return fmt.Errorf("apply restored proxy settings: %w", err)
	}
	return nil
}

func (s *SyncService) applyRestoredProxySettingsWithinCryptoOperation() error {
	if s.runtimeSettings == nil {
		return nil
	}
	if err := s.runtimeSettings.ApplyStoredProxySettingsWithinCryptoOperation(); err != nil {
		return fmt.Errorf("apply restored proxy settings: %w", err)
	}
	return nil
}
