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
			s.replaceVolatile(account, nil)
			return true
		}
	}
	s.replaceVolatile(account, []byte(value))
	return false
}

func (s *aiSecretStore) delete(account string) error {
	if s.keychain != nil {
		if err := s.keychain.Delete(aiKeychainService, account); err != nil {
			return fmt.Errorf("delete AI secret: %w", err)
		}
	}
	s.replaceVolatile(account, nil)
	return nil
}

func (s *aiSecretStore) replaceVolatile(account string, value []byte) {
	s.mu.Lock()
	clear(s.volatile[account])
	if len(value) == 0 {
		delete(s.volatile, account)
	} else {
		s.volatile[account] = append([]byte(nil), value...)
	}
	s.mu.Unlock()
}

func (s *aiSecretStore) isVolatile(account string) bool {
	s.mu.RLock()
	_, exists := s.volatile[account]
	s.mu.RUnlock()
	return exists
}

func (s *aiSecretStore) clearMemory() {
	if s == nil {
		return
	}
	s.mu.Lock()
	for account, value := range s.volatile {
		clear(value)
		delete(s.volatile, account)
	}
	s.mu.Unlock()
}
