package service

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func jumpHostSessionInput() model.SessionInput {
	return model.SessionInput{Name: "internal", Host: "10.0.0.1", Port: 22, Username: "target", AuthMethod: model.AuthPassword, Password: "target-secret",
		JumpHost: &model.SSHJumpHost{Host: "bastion.example", Port: 2222, Username: "jump", AuthMethod: model.AuthPassword, Password: "jump-secret"}}
}

func TestSessionJumpHostPasswordEncryptionAndRedaction(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	input := jumpHostSessionInput()
	created, err := svc.CreateSession(input)
	require.NoError(t, err)
	require.NotNil(t, created.JumpHost)
	assert.Empty(t, created.Password)
	assert.Empty(t, created.JumpHost.Password)
	assert.Equal(t, "jump-secret", input.JumpHost.Password)
	stored, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	require.NoError(t, validateStoredSessionPassword(stored.Password))
	require.NoError(t, validateStoredSessionPassword(stored.JumpHost.Password))
	assert.NotEqual(t, input.Password, stored.Password)
	assert.NotEqual(t, input.JumpHost.Password, stored.JumpHost.Password)
	loaded, err := svc.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, input.Password, loaded.Password)
	assert.Equal(t, input.JumpHost.Password, loaded.JumpHost.Password)
	require.NoError(t, store.MarkSessionConnected(db, created.ID))
	single, err := svc.GetSession(created.ID)
	require.NoError(t, err)
	listed, err := svc.ListSessions(nil)
	require.NoError(t, err)
	recent, err := svc.ListRecentSessions(10)
	require.NoError(t, err)
	for _, session := range append(append(listed, recent...), *single) {
		encoded, encodeErr := json.Marshal(session)
		require.NoError(t, encodeErr)
		assert.NotContains(t, string(encoded), `"password":`)
		assert.NotContains(t, string(encoded), "secret")
	}
}

func TestSessionJumpHostUpdateReusesPasswordOnlyForSameIdentity(t *testing.T) {
	tests := []struct {
		name string
		edit func(*model.SSHJumpHost)
		kept bool
	}{
		{name: "same identity", edit: func(*model.SSHJumpHost) {}, kept: true},
		{name: "trim whitespace", edit: func(jump *model.SSHJumpHost) { jump.Host = " bastion.example "; jump.Username = " jump " }, kept: true},
		{name: "changed host", edit: func(jump *model.SSHJumpHost) { jump.Host = "other.example" }},
		{name: "changed port", edit: func(jump *model.SSHJumpHost) { jump.Port = 22 }},
		{name: "changed username", edit: func(jump *model.SSHJumpHost) { jump.Username = "other" }},
		{name: "changed auth", edit: func(jump *model.SSHJumpHost) { jump.AuthMethod = model.AuthKeyboardInteractive }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
			created, err := svc.CreateSession(jumpHostSessionInput())
			require.NoError(t, err)
			input := model.SessionInputFrom(*created)
			test.edit(input.JumpHost)
			require.NoError(t, svc.UpdateSession(input))
			loaded, err := svc.sessionForConnect(created.ID)
			require.NoError(t, err)
			assert.Equal(t, test.kept, loaded.JumpHost.Password == "jump-secret")
			assert.Equal(t, "target-secret", loaded.Password)
		})
	}
}

func TestSessionJumpHostCanReplaceAndClearPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	created, err := svc.CreateSession(jumpHostSessionInput())
	require.NoError(t, err)
	input := model.SessionInputFrom(*created)
	input.JumpHost.Password = "new-jump-secret"
	require.NoError(t, svc.UpdateSession(input))
	loaded, err := svc.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "new-jump-secret", loaded.JumpHost.Password)
	input.JumpHost = nil
	require.NoError(t, svc.UpdateSession(input))
	stored, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Nil(t, stored.JumpHost)
	var password string
	require.NoError(t, db.QueryRow("SELECT jump_password FROM sessions WHERE id = ?", created.ID).Scan(&password))
	assert.Empty(t, password)
}

func TestSessionJumpHostRedactionDoesNotMutateSource(t *testing.T) {
	source := jumpHostSessionInput().Session()
	redacted := redactSessionPassword(&source)
	assert.Empty(t, redacted.JumpHost.Password)
	assert.Equal(t, "jump-secret", source.JumpHost.Password)
	redacted.JumpHost.Host = "changed"
	assert.Equal(t, "bastion.example", source.JumpHost.Host)
	sessions := []model.Session{source}
	list := redactSessionPasswords(sessions)
	assert.Empty(t, list[0].JumpHost.Password)
	assert.Equal(t, "target-secret", sessions[0].Password)
	assert.Equal(t, "jump-secret", sessions[0].JumpHost.Password)
	assert.Nil(t, redactSessionPassword(nil))
	assert.Nil(t, redactSessionPasswords(nil))
}
