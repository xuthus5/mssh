package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSSHJumpHostPasswordRequiresVaultForCreateAndUpdate(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	input := jumpHostSessionInput()
	input.Password = ""
	_, err := svc.CreateSession(input)
	require.ErrorIs(t, err, ErrVaultLocked)
	var count int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM sessions").Scan(&count))
	assert.Zero(t, count)
	svc.crypto = newUnlockedSessionTestCrypto()
	created, err := svc.CreateSession(input)
	require.NoError(t, err)
	before, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	svc.crypto = nil
	input.ID = created.ID
	input.JumpHost.Password = "changed"
	require.ErrorIs(t, svc.UpdateSession(input), ErrVaultLocked)
	_, err = svc.sessionForConnect(created.ID)
	require.ErrorIs(t, err, ErrVaultLocked)
	after, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, before.JumpHost.Password, after.JumpHost.Password)
}

func TestSSHJumpHostRejectsCorruptedStoredPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	created, err := svc.CreateSession(jumpHostSessionInput())
	require.NoError(t, err)
	_, err = db.Exec("UPDATE sessions SET jump_password = ? WHERE id = ?", "plaintext", created.ID)
	require.NoError(t, err)
	_, err = svc.sessionForConnect(created.ID)
	require.ErrorContains(t, err, "SSH jump host password")
	input := model.SessionInputFrom(*created)
	require.ErrorContains(t, svc.UpdateSession(input), "SSH jump host password")
	input.JumpHost.Host = "another.example"
	require.NoError(t, svc.UpdateSession(input))
	loaded, err := svc.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Empty(t, loaded.JumpHost.Password)
}

func TestSSHJumpHostTestCredentialsReuseOnlyMatchingIdentity(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	created, err := svc.CreateSession(jumpHostSessionInput())
	require.NoError(t, err)
	input := model.SSHJumpHostTestInput{SessionID: created.ID, JumpHost: *created.JumpHost}
	loaded, err := svc.jumpHostForTest(input)
	require.NoError(t, err)
	assert.Equal(t, "jump-secret", loaded.Password)
	assert.Empty(t, input.JumpHost.Password)
	input.JumpHost.Host = "another.example"
	loaded, err = svc.jumpHostForTest(input)
	require.NoError(t, err)
	assert.Empty(t, loaded.Password)
	input.JumpHost.Password = "unsaved-secret"
	loaded, err = svc.jumpHostForTest(input)
	require.NoError(t, err)
	assert.Equal(t, input.JumpHost.Password, loaded.Password)
	stored, err := svc.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "jump-secret", stored.JumpHost.Password)
	assert.Equal(t, "bastion.example", stored.JumpHost.Host)
}

func TestSSHJumpHostTestCredentialFailures(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	created, err := svc.CreateSession(jumpHostSessionInput())
	require.NoError(t, err)
	tests := []struct {
		name string
		edit func(*model.SSHJumpHostTestInput)
	}{
		{name: "invalid id", edit: func(input *model.SSHJumpHostTestInput) { input.SessionID = -1 }},
		{name: "invalid host", edit: func(input *model.SSHJumpHostTestInput) { input.JumpHost.Host = "" }},
		{name: "missing session", edit: func(input *model.SSHJumpHostTestInput) { input.SessionID = created.ID + 1 }},
		{name: "password bound", edit: func(input *model.SSHJumpHostTestInput) {
			input.JumpHost.Password = strings.Repeat("x", maxSessionPasswordBytes+1)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := model.SSHJumpHostTestInput{SessionID: created.ID, JumpHost: *created.JumpHost}
			test.edit(&input)
			loaded, err := svc.jumpHostForTest(input)
			require.Error(t, err)
			assert.Nil(t, loaded)
		})
	}
	svc.crypto = nil
	_, err = svc.jumpHostForTest(model.SSHJumpHostTestInput{SessionID: created.ID, JumpHost: *created.JumpHost})
	require.ErrorIs(t, err, ErrVaultLocked)
}

func TestSSHJumpHostNewTestAndAgentDoNotLoadStoredPassword(t *testing.T) {
	svc := &SessionService{}
	input := model.SSHJumpHostTestInput{JumpHost: *jumpHostSessionInput().JumpHost}
	input.JumpHost.Password = ""
	loaded, err := svc.jumpHostForTest(input)
	require.NoError(t, err)
	assert.Empty(t, loaded.Password)
	input.SessionID = 99
	input.JumpHost.AuthMethod = model.AuthAgent
	input.JumpHost.Password = "unused"
	loaded, err = svc.jumpHostForTest(input)
	require.NoError(t, err)
	assert.Empty(t, loaded.Password)
	jump, err := svc.prepareSSHJumpHost(&input.JumpHost, nil)
	require.NoError(t, err)
	assert.Empty(t, jump.Password)
}
