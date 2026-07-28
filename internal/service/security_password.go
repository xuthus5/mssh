package service

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	maxSessionPasswordBytes           = 64 * 1024
	sessionPasswordCiphertextOverhead = aesGCMEnvelopeOverhead
	maxSessionPasswordPayloadBytes    = ((maxSessionPasswordBytes + aesGCMEnvelopeOverhead + 2) / 3) * 4
	maxStoredSessionPasswordBytes     = len(sessionPasswordPrefix) + maxSessionPasswordPayloadBytes
)

func sealSessionPassword(c KeyCrypto, plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	if err := validatePlainSessionPassword(plain); err != nil {
		return "", err
	}
	if err := requireSessionPasswordCrypto(c); err != nil {
		return "", err
	}
	plaintext := []byte(plain)
	defer clear(plaintext)
	sealed, err := c.Encrypt(plaintext)
	if err != nil {
		return "", err
	}
	defer clear(sealed)
	if len(sealed) > maxSessionPasswordPayloadBytes {
		return "", fmt.Errorf("encrypted session password exceeds %d bytes", maxSessionPasswordPayloadBytes)
	}
	stored := sessionPasswordPrefix + strings.Clone(string(sealed))
	if err := validateStoredSessionPassword(stored); err != nil {
		return "", fmt.Errorf("invalid encrypted session password: %w", err)
	}
	return stored, nil
}

func openSessionPassword(c KeyCrypto, stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if err := validateStoredSessionPassword(stored); err != nil {
		return "", err
	}
	if err := requireSessionPasswordCrypto(c); err != nil {
		return "", err
	}
	payload := []byte(strings.TrimPrefix(stored, sessionPasswordPrefix))
	defer clear(payload)
	plain, err := c.Decrypt(payload)
	if err != nil {
		return "", err
	}
	defer clear(plain)
	if len(plain) > maxSessionPasswordBytes {
		return "", fmt.Errorf("session password exceeds %d bytes", maxSessionPasswordBytes)
	}
	if !utf8.Valid(plain) {
		return "", fmt.Errorf("session password must be valid UTF-8")
	}
	return strings.Clone(string(plain)), nil
}

func requireSessionPasswordCrypto(c KeyCrypto) error {
	if c == nil {
		return ErrVaultLocked
	}
	if runtime, ok := c.(*CryptoRuntime); ok {
		return runtime.RequireUnlocked()
	}
	return nil
}

func validateStoredSessionPassword(stored string) error {
	if stored == "" {
		return nil
	}
	if len(stored) > maxStoredSessionPasswordBytes {
		return fmt.Errorf("encrypted session password exceeds %d bytes", maxStoredSessionPasswordBytes)
	}
	if !strings.HasPrefix(stored, sessionPasswordPrefix) {
		return fmt.Errorf("session password is not encrypted with application vault")
	}
	payload := strings.TrimPrefix(stored, sessionPasswordPrefix)
	return validateBase64AESGCMEnvelope(payload, maxSessionPasswordBytes, "session password ciphertext")
}

func validatePlainSessionPassword(password string) error {
	if !utf8.ValidString(password) {
		return fmt.Errorf("session password must be valid UTF-8")
	}
	if len(password) > maxSessionPasswordBytes {
		return fmt.Errorf("session password exceeds %d bytes", maxSessionPasswordBytes)
	}
	return nil
}
