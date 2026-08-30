package crypto

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	keyring "github.com/zalando/go-keyring"
)

func TestDefaultKeychainRoundTrip(t *testing.T) {
	keyring.MockInit()
	kc := &defaultKeychain{available: func() bool { return true }}
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

func TestDefaultKeychainIsAvailableUsesOverride(t *testing.T) {
	kc := &defaultKeychain{available: func() bool { return false }}
	assert.False(t, kc.IsAvailable())
	kc.available = func() bool { return true }
	assert.True(t, kc.IsAvailable())
}

type stubSecretServiceProber struct {
	owner    string
	ownerErr error
	names    []string
	namesErr error
}

func (s stubSecretServiceProber) NameOwner(string) (string, error) { return s.owner, s.ownerErr }

func (s stubSecretServiceProber) ActivatableNames() ([]string, error) { return s.names, s.namesErr }

func TestProbeSecretService(t *testing.T) {
	tests := []struct {
		name   string
		prober stubSecretServiceProber
		want   bool
	}{
		{"provider owns the name", stubSecretServiceProber{owner: ":1.39"}, true},
		{"not owned but activatable", stubSecretServiceProber{names: []string{"org.foo", secretServiceName}}, true},
		{"not owned nor activatable", stubSecretServiceProber{names: []string{"org.foo"}}, false},
		{"empty owner falls through to activatable", stubSecretServiceProber{names: []string{"org.foo"}}, false},
		{"name owner fails but activatable", stubSecretServiceProber{ownerErr: assert.AnError, names: []string{secretServiceName}}, true},
		{"activatable query fails", stubSecretServiceProber{ownerErr: assert.AnError, namesErr: assert.AnError}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, probeSecretService(tt.prober))
		})
	}
}

func TestKeychainPlatformAvailableProbe(t *testing.T) {
	result := keychainPlatformAvailable()
	assert.IsType(t, true, result)
}

func TestDefaultKeychainPropagatesProviderErrors(t *testing.T) {
	keyring.MockInitWithError(assert.AnError)
	kc := NewKeychainAdapter()
	_, err := kc.Get("service", "account")
	assert.ErrorIs(t, err, assert.AnError)
	assert.ErrorIs(t, kc.Set("service", "account", []byte("data")), assert.AnError)
	assert.ErrorIs(t, kc.Delete("service", "account"), assert.AnError)
}
