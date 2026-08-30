package crypto

import (
	"errors"

	keyring "github.com/zalando/go-keyring"
)

type defaultKeychain struct {
	// available, when set, overrides the platform availability probe.
	// Tests use it to force a deterministic answer.
	available func() bool
}

func (d *defaultKeychain) Get(service, account string) ([]byte, error) {
	value, err := keyring.Get(service, account)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil, nil
	}
	return []byte(value), err
}

func (d *defaultKeychain) Set(service, account string, data []byte) error {
	return keyring.Set(service, account, string(data))
}

func (d *defaultKeychain) Delete(service, account string) error {
	err := keyring.Delete(service, account)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

func (d *defaultKeychain) IsAvailable() bool {
	if d.available != nil {
		return d.available()
	}
	return keychainPlatformAvailable()
}

func NewKeychainAdapter() KeychainAdapter { return &defaultKeychain{} }
