package app

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/xuthus5/mssh/internal/crypto"
)

type cryptoAdapter struct {
	key []byte
}

func (c *cryptoAdapter) Encrypt(plaintext []byte) ([]byte, error) {
	return crypto.Encrypt(plaintext, c.key)
}

func (c *cryptoAdapter) Decrypt(ciphertext []byte) ([]byte, error) {
	return crypto.Decrypt(ciphertext, c.key)
}

const masterKeyFile = "master.key"

func loadMasterKey(dataDir string, keychain crypto.KeychainAdapter, logger *slog.Logger) ([]byte, error) {
	if keychain.IsAvailable() {
		key, err := keychain.Get("mssh", "master-key")
		if err == nil && len(key) == 32 {
			logger.Info("master key loaded from keychain")
			return key, nil
		}
		if err != nil {
			logger.Warn("keychain get failed", "error", err)
		}
	}
	keyPath := filepath.Join(dataDir, masterKeyFile)
	if err := ensureMasterKeyStorage(dataDir, keyPath); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(keyPath)
	if err == nil && len(data) == 32 {
		logger.Info("master key loaded from file")
		return data, nil
	}
	return nil, nil
}

func ensureMasterKeyStorage(dataDir, keyPath string) error {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return fmt.Errorf("create master key directory: %w", err)
	}
	if err := os.Chmod(dataDir, 0o700); err != nil {
		return fmt.Errorf("secure master key directory: %w", err)
	}
	info, err := os.Stat(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect master key file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("master key path is not a regular file")
	}
	if err := os.Chmod(keyPath, 0o600); err != nil {
		return fmt.Errorf("secure master key file: %w", err)
	}
	return nil
}

type masterKeyPersistence struct {
	dataDir  string
	key      []byte
	keychain crypto.KeychainAdapter
	logger   *slog.Logger
}

func persistMasterKey(input masterKeyPersistence) {
	if input.keychain.IsAvailable() {
		if err := input.keychain.Set("mssh", "master-key", input.key); err != nil {
			input.logger.Warn("keychain set failed", "error", err)
		} else {
			input.logger.Info("master key persisted to keychain")
		}
	}
	keyPath := filepath.Join(input.dataDir, masterKeyFile)
	if err := ensureMasterKeyStorage(input.dataDir, keyPath); err != nil {
		input.logger.Warn("secure master key storage failed", "error", err)
		return
	}
	if err := os.WriteFile(keyPath, input.key, 0o600); err != nil {
		input.logger.Warn("write master key file failed", "error", err)
	} else {
		input.logger.Info("master key persisted to file")
	}
}
