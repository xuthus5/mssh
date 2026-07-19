package service

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAISecretStoreUsesKeychainAndVolatileFallback(t *testing.T) {
	keychain := &aiMemoryKeychain{data: make(map[string][]byte), available: true}
	store := newAISecretStore(keychain)
	assert.True(t, store.set("provider:1", "saved"))
	value, saved, err := store.get("provider:1")
	require.NoError(t, err)
	assert.True(t, saved)
	assert.Equal(t, "saved", value)
	require.NoError(t, store.delete("provider:1"))
	value, saved, err = store.get("provider:1")
	require.NoError(t, err)
	assert.False(t, saved)
	assert.Empty(t, value)
	keychain.err = errors.New("keychain unavailable")
	assert.False(t, store.set("provider:2", "volatile"))
	value, saved, err = store.get("provider:2")
	require.NoError(t, err)
	assert.True(t, saved)
	assert.Equal(t, "volatile", value)
}

func TestAISecretStorePropagatesReadAndDeleteErrors(t *testing.T) {
	keychain := &aiMemoryKeychain{data: make(map[string][]byte), available: true, err: assert.AnError}
	store := newAISecretStore(keychain)
	_, _, err := store.get("missing")
	assert.ErrorIs(t, err, assert.AnError)
	assert.ErrorIs(t, store.delete("missing"), assert.AnError)
}
