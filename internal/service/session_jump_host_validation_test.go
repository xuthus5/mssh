package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSSHJumpHostValidationRejectsInvalidConnectionFields(t *testing.T) {
	tests := []struct {
		name string
		edit func(*model.SSHJumpHost)
	}{
		{name: "blank host", edit: func(jump *model.SSHJumpHost) { jump.Host = " " }},
		{name: "host utf8", edit: func(jump *model.SSHJumpHost) { jump.Host = string([]byte{0xff}) }},
		{name: "host length", edit: func(jump *model.SSHJumpHost) { jump.Host = strings.Repeat("h", sessionHostLimit+1) }},
		{name: "host nul", edit: func(jump *model.SSHJumpHost) { jump.Host = "host\x00name" }},
		{name: "blank username", edit: func(jump *model.SSHJumpHost) { jump.Username = " " }},
		{name: "username length", edit: func(jump *model.SSHJumpHost) { jump.Username = strings.Repeat("u", sessionUsernameLimit+1) }},
		{name: "zero port", edit: func(jump *model.SSHJumpHost) { jump.Port = 0 }},
		{name: "port range", edit: func(jump *model.SSHJumpHost) { jump.Port = 65536 }},
		{name: "unsupported auth", edit: func(jump *model.SSHJumpHost) { jump.AuthMethod = "unsupported" }},
		{name: "key without id", edit: func(jump *model.SSHJumpHost) { jump.AuthMethod = model.AuthKey }},
		{name: "invalid key id", edit: func(jump *model.SSHJumpHost) { id := int64(-1); jump.KeyID = &id }},
	}
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := jumpHostSessionInput()
			test.edit(input.JumpHost)
			_, err := svc.CreateSession(input)
			require.Error(t, err)
			assert.NotErrorIs(t, err, ErrVaultLocked)
		})
	}
	var count int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM sessions").Scan(&count))
	assert.Zero(t, count)
}

func TestSSHJumpHostValidationAcceptsSupportedAuthentication(t *testing.T) {
	require.NoError(t, validateSSHJumpHost(nil))
	for _, method := range []model.AuthMethod{model.AuthPassword, model.AuthAgent, model.AuthKey, model.AuthKeyboardInteractive} {
		jump := jumpHostSessionInput().JumpHost
		jump.AuthMethod = method
		keyID := int64(1)
		if method == model.AuthKey {
			jump.KeyID = &keyID
		}
		require.NoError(t, validateSSHJumpHost(jump))
	}
}

func TestNormalizeSSHJumpHostDropsInactiveCredentialsWithoutMutatingInput(t *testing.T) {
	require.Nil(t, normalizeSSHJumpHost(nil))
	for _, method := range []model.AuthMethod{model.AuthPassword, model.AuthAgent, model.AuthKey} {
		source := jumpHostSessionInput().JumpHost
		source.Host = " bastion.example "
		source.Username = " jump "
		source.AuthMethod = method
		keyID := int64(7)
		source.KeyID = &keyID
		normalized := normalizeSSHJumpHost(source)
		assert.Equal(t, "bastion.example", normalized.Host)
		assert.Equal(t, "jump", normalized.Username)
		assert.Equal(t, "jump-secret", source.Password)
		if method == model.AuthKey {
			assert.Empty(t, normalized.Password)
			assert.Equal(t, keyID, *normalized.KeyID)
			assert.NotSame(t, source.KeyID, normalized.KeyID)
		} else {
			assert.Nil(t, normalized.KeyID)
			assert.Equal(t, method == model.AuthPassword, normalized.Password != "")
		}
	}
}
