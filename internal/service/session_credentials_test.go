package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionServiceGetSessionCredentialsDecryptsPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	created, err := service.CreateSession(model.SessionInput{
		Name: "credentials", Host: "10.0.0.1", Port: 22, Username: "deploy",
		AuthMethod: model.AuthPassword, Password: "s3cret", KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	credentials, err := service.GetSessionCredentials(created.ID)

	require.NoError(t, err)
	require.NotNil(t, credentials)
	assert.Equal(t, "deploy", credentials.Username)
	assert.Equal(t, "s3cret", credentials.Password)
}

func TestSessionServiceGetSessionCredentialsEmptyPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	created, err := service.CreateSession(model.SessionInput{
		Name: "credentials-no-password", Host: "10.0.0.2", Port: 22, Username: "git",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	credentials, err := service.GetSessionCredentials(created.ID)

	require.NoError(t, err)
	require.NotNil(t, credentials)
	assert.Equal(t, "git", credentials.Username)
	assert.Empty(t, credentials.Password)
}

func TestSessionServiceGetSessionCredentialsInvalidID(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())

	credentials, err := service.GetSessionCredentials(0)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid session id")
	assert.Nil(t, credentials)
}

func TestSessionServiceGetSessionCredentialsMissingSession(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())

	credentials, err := service.GetSessionCredentials(9999)

	require.Error(t, err)
	assert.Nil(t, credentials)
}

func TestSessionServiceGetSessionCredentialsLockedVault(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	created, err := store.CreateSession(db, model.Session{
		Name: "credentials-locked", Host: "10.0.0.3", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: testStoredSessionPassword(t, "secret"), KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	credentials, err := service.GetSessionCredentials(created.ID)

	require.Error(t, err)
	assert.Nil(t, credentials)
}

func TestSessionServiceGetSessionCredentialsStoppedService(t *testing.T) {
	service := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), newUnlockedSessionTestCrypto(), testutil.NewTestLogger())
	service.StopOperationsAndWait()

	credentials, err := service.GetSessionCredentials(1)

	require.Error(t, err)
	assert.Nil(t, credentials)
}
