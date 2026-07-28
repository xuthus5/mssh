package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionService_ImportCSVEncryptsPasswordThatLooksLikeCiphertext(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	security := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: false})
	require.NoError(t, err)
	service := NewSessionService(db, newMockEventBus(), 30, dir, runtime, testutil.NewTestLogger())
	path := writeSessionCSVFixture(t, []map[string]string{
		csvFixtureRow(map[string]string{
			"name":     "looks-encrypted",
			"password": "enc1:not-a-ciphertext",
		}),
	})

	summary, err := service.ImportCSV(path, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
	require.NoError(t, err)
	assert.Equal(t, 1, summary.Imported)

	sessions, err := store.ListSessions(db, nil)
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	assert.NotEqual(t, "enc1:not-a-ciphertext", sessions[0].Password)
	plain, err := openSessionPassword(runtime, sessions[0].Password)
	require.NoError(t, err)
	assert.Equal(t, "enc1:not-a-ciphertext", plain)
}
