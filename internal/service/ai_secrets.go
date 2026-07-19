package service

import (
	"fmt"
	"sync"

	"github.com/xuthus5/mssh/internal/crypto"
)

const aiKeychainService = "mssh.ai"

type aiSecretStore struct {
	keychain crypto.KeychainAdapter
	mu       sync.RWMutex
	volatile map[string][]byte
}

func newAISecretStore(keychain crypto.KeychainAdapter) *aiSecretStore {
	return &aiSecretStore{keychain: keychain, volatile: make(map[string][]byte)}
}

func (s *aiSecretStore) get(account string) (string, bool, error) {
	s.mu.RLock()
	value, exists := s.volatile[account]
	s.mu.RUnlock()
	if exists {
		return string(value), true, nil
	}
	if s.keychain == nil {
		return "", false, nil
	}
	data, err := s.keychain.Get(aiKeychainService, account)
	if err != nil {
		return "", false, fmt.Errorf("read AI secret: %w", err)
	}
	return string(data), len(data) > 0, nil
}

func (s *aiSecretStore) set(account, value string) bool {
	if value == "" {
		return false
	}
	if s.keychain != nil && s.keychain.IsAvailable() {
		if err := s.keychain.Set(aiKeychainService, account, []byte(value)); err == nil {
			return true
		}
	}
	s.mu.Lock()
	s.volatile[account] = []byte(value)
	s.mu.Unlock()
	return false
}

func (s *aiSecretStore) delete(account string) error {
	s.mu.Lock()
	delete(s.volatile, account)
	s.mu.Unlock()
	if s.keychain == nil {
		return nil
	}
	if err := s.keychain.Delete(aiKeychainService, account); err != nil {
		return fmt.Errorf("delete AI secret: %w", err)
	}
	return nil
}
