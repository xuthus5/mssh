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
	mu          sync.RWMutex
	operationMu sync.Mutex
	dek         []byte
}

func NewCryptoRuntime() *CryptoRuntime {
	return &CryptoRuntime{}
}

// WithCryptoOperation serializes database operations that use the active DEK.
//
//wails:ignore
func (c *CryptoRuntime) WithCryptoOperation(operation func() error) error {
	if c == nil {
		return ErrVaultLocked
	}
	c.lockOperation()
	defer c.unlockOperation()
	return operation()
}

func (c *CryptoRuntime) lockOperation() {
	c.operationMu.Lock()
}

func (c *CryptoRuntime) unlockOperation() {
	c.operationMu.Unlock()
}

func withCryptoOperation(keyCrypto KeyCrypto, operation func() error) error {
	coordinator, ok := keyCrypto.(interface{ WithCryptoOperation(func() error) error })
	if !ok {
		return operation()
	}
	return coordinator.WithCryptoOperation(operation)
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
	defer clear(dek)
	return crypto.Encrypt(plaintext, dek)
}

func (c *CryptoRuntime) Decrypt(ciphertext []byte) ([]byte, error) {
	dek, err := c.DEK()
	if err != nil {
		return nil, err
	}
	defer clear(dek)
	return crypto.Decrypt(ciphertext, dek)
}
