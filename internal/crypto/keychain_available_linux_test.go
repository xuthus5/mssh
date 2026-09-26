//go:build linux

package crypto

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

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
