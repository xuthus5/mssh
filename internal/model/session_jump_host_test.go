package model

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSessionJumpHostDefaultsToDisabled(t *testing.T) {
	var input SessionInput
	require.NoError(t, json.Unmarshal([]byte(`{"host":"internal.example"}`), &input))
	assert.Nil(t, input.JumpHost)
	assert.Nil(t, input.Session().JumpHost)
	encoded, err := json.Marshal(input.Session())
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "jump_host")
}

func TestSessionJumpHostConversionCopiesCredentials(t *testing.T) {
	keyID := int64(7)
	input := SessionInput{JumpHost: &SSHJumpHost{
		Host: "bastion.example", Port: 22, Username: "jump", AuthMethod: AuthKey, KeyID: &keyID,
	}}
	session := input.Session()
	require.Equal(t, input.JumpHost, session.JumpHost)
	converted := SessionInputFrom(session)
	require.Equal(t, session.JumpHost, converted.JumpHost)
	session.JumpHost.Password = "changed"
	*session.JumpHost.KeyID = 8
	assert.Empty(t, input.JumpHost.Password)
	assert.Equal(t, int64(7), *input.JumpHost.KeyID)
	assert.Empty(t, converted.JumpHost.Password)
	assert.Equal(t, int64(7), *converted.JumpHost.KeyID)
}

func TestSSHJumpHostTestInputJSON(t *testing.T) {
	input := SSHJumpHostTestInput{SessionID: 3, RequestID: "test-1", JumpHost: SSHJumpHost{
		Host: "bastion.example", Port: 2222, Username: "jump", AuthMethod: AuthPassword, Password: "secret",
	}}
	encoded, err := json.Marshal(input)
	require.NoError(t, err)
	var decoded SSHJumpHostTestInput
	require.NoError(t, json.Unmarshal(encoded, &decoded))
	assert.Equal(t, input, decoded)
}
