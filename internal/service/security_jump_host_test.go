package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSecurityRotateReencryptsSSHJumpHostPasswords(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	security := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "initial-pass-12"})
	require.NoError(t, err)
	sessions := NewSessionService(db, newMockEventBus(), 30, dir, runtime, testutil.NewTestLogger())
	input := jumpHostSessionInput()
	first, err := sessions.CreateSession(input)
	require.NoError(t, err)
	input.Password = ""
	second, err := sessions.CreateSession(input)
	require.NoError(t, err)
	before, err := store.GetSession(db, first.ID)
	require.NoError(t, err)
	_, err = security.Rotate(model.SecurityRotateInput{CurrentPassword: "initial-pass-12", NewPassword: "rotated-pass-12"})
	require.NoError(t, err)
	after, err := store.GetSession(db, first.ID)
	require.NoError(t, err)
	assert.NotEqual(t, before.Password, after.Password)
	assert.NotEqual(t, before.JumpHost.Password, after.JumpHost.Password)
	for _, id := range []int64{first.ID, second.ID} {
		loaded, loadErr := sessions.sessionForConnect(id)
		require.NoError(t, loadErr)
		assert.Equal(t, "jump-secret", loaded.JumpHost.Password)
	}
	credentials, err := sessions.GetSessionCredentials(first.ID)
	require.NoError(t, err)
	assert.Equal(t, "target-secret", credentials.Password)
	assert.Equal(t, "jump-secret", credentials.JumpHostPassword)
}

func TestReencryptPlanRejectsCorruptSSHJumpPasswordBeforeWrites(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := newUnlockedSessionTestCrypto()
	sessions := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), runtime, testutil.NewTestLogger())
	created, err := sessions.CreateSession(jumpHostSessionInput())
	require.NoError(t, err)
	before, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	_, err = db.Exec("UPDATE sessions SET jump_password = ? WHERE id = ?", "not-encrypted", created.ID)
	require.NoError(t, err)
	_, err = buildReencryptPlan(db, runtime, runtime)
	require.ErrorContains(t, err, "jump host password")
	after, err := store.GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, before.Password, after.Password)
	assert.Equal(t, "not-encrypted", after.JumpHost.Password)
}
