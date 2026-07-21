package service

import (
	"errors"
	"sync"

	"github.com/xuthus5/mssh/internal/crypto"
)

// ErrVaultLocked is returned when crypto operations require an unlocked application vault.
var ErrVaultLocked = errors.New("application vault is locked")

// CryptoRuntime is a hot-swappable KeyCrypto backed by the vault DEK.
type CryptoRuntime struct {
	mu  sync.RWMutex
	dek []byte
}

func NewCryptoRuntime() *CryptoRuntime {
	return &CryptoRuntime{}
}

func (c *CryptoRuntime) SetDEK(dek []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if dek == nil {
		c.dek = nil
		return
	}
	c.dek = append([]byte(nil), dek...)
}

func (c *CryptoRuntime) Clear() {
	c.mu.Lock()
	if c.dek != nil {
		for i := range c.dek {
			c.dek[i] = 0
		}
		c.dek = nil
	}
	c.mu.Unlock()
}

func (c *CryptoRuntime) Unlocked() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.dek) == 32
}

// RequireUnlocked returns ErrVaultLocked when the DEK is not available.
func (c *CryptoRuntime) RequireUnlocked() error {
	if c == nil || !c.Unlocked() {
		return ErrVaultLocked
	}
	return nil
}

func (c *CryptoRuntime) DEK() ([]byte, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.dek) != 32 {
		return nil, ErrVaultLocked
	}
	return append([]byte(nil), c.dek...), nil
}

func (c *CryptoRuntime) Encrypt(plaintext []byte) ([]byte, error) {
	dek, err := c.DEK()
	if err != nil {
		return nil, err
	}
	return crypto.Encrypt(plaintext, dek)
}

func (c *CryptoRuntime) Decrypt(ciphertext []byte) ([]byte, error) {
	dek, err := c.DEK()
	if err != nil {
		return nil, err
	}
	return crypto.Decrypt(ciphertext, dek)
}
