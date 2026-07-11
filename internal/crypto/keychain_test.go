package crypto

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDefaultKeychainNotAvailable(t *testing.T) {
	kc := NewKeychainAdapter()
	assert.False(t, kc.IsAvailable())
}

func TestDefaultKeychainGetSet(t *testing.T) {
	kc := NewKeychainAdapter()
	err := kc.Set("svc", "acct", []byte("data"))
	assert.NoError(t, err)
	v, err := kc.Get("svc", "acct")
	assert.NoError(t, err)
	assert.Nil(t, v)
}

func TestDefaultKeychainAllOps(t *testing.T) {
	kc := NewKeychainAdapter()

	// Default keychain is unavailable
	assert.False(t, kc.IsAvailable())

	// Get returns nil, nil
	data, err := kc.Get("service", "account")
	assert.NoError(t, err)
	assert.Nil(t, data)

	// Set is a no-op
	err = kc.Set("service", "account", []byte("data"))
	assert.NoError(t, err)

	// Delete is a no-op
	err = kc.Delete("service", "account")
	assert.NoError(t, err)
}
