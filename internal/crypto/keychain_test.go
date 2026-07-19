package crypto

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	keyring "github.com/zalando/go-keyring"
)

func TestDefaultKeychainRoundTrip(t *testing.T) {
	keyring.MockInit()
	kc := NewKeychainAdapter()
	assert.True(t, kc.IsAvailable())
	require.NoError(t, kc.Set("svc", "acct", []byte("data")))
	value, err := kc.Get("svc", "acct")
	require.NoError(t, err)
	assert.Equal(t, []byte("data"), value)
	require.NoError(t, kc.Delete("svc", "acct"))
	require.NoError(t, kc.Delete("svc", "acct"))
	value, err = kc.Get("svc", "acct")
	require.NoError(t, err)
	assert.Nil(t, value)
}

func TestDefaultKeychainPropagatesProviderErrors(t *testing.T) {
	keyring.MockInitWithError(assert.AnError)
	kc := NewKeychainAdapter()
	_, err := kc.Get("service", "account")
	assert.ErrorIs(t, err, assert.AnError)
	assert.ErrorIs(t, kc.Set("service", "account", []byte("data")), assert.AnError)
	assert.ErrorIs(t, kc.Delete("service", "account"), assert.AnError)
}
