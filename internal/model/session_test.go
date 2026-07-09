package model

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSessionJSONSerialization(t *testing.T) {
	s := Session{
		Name:       "test-host",
		Host:       "192.168.1.1",
		Port:       22,
		Username:   "root",
		AuthMethod: AuthPassword,
	}
	data, err := json.Marshal(s)
	require.NoError(t, err)
	var decoded Session
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)
	assert.Equal(t, "test-host", decoded.Name)
	assert.Equal(t, "192.168.1.1", decoded.Host)
}

func TestSSHKeyPrivateKeyExcluded(t *testing.T) {
	k := SSHKey{
		Name:       "my-key",
		PrivateKey: "secret",
		PublicKey:  "public",
	}
	data, err := json.Marshal(k)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "secret")
}

func TestTunnelTypeConstants(t *testing.T) {
	assert.Equal(t, TunnelType("local"), TunnelLocal)
	assert.Equal(t, TunnelType("remote"), TunnelRemote)
	assert.Equal(t, TunnelType("dynamic"), TunnelDynamic)
}
