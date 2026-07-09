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
