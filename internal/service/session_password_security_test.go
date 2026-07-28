package service

import (
	"database/sql"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionServiceCreateWithoutCryptoRejectsPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	_, err := service.CreateSession(model.SessionInputFrom(model.Session{
		Name: "locked", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "plain-secret", KeepAlive: 30, TermType: "xterm",
	}))

	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrVaultLocked))
	assertTableHasNoSessionPassword(t, db)
}

func TestSessionServiceUpdateWithoutCryptoRejectsNewPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	created, err := store.CreateSession(db, model.Session{
		Name: "locked-update", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())

	err = service.UpdateSession(model.SessionInputFrom(model.Session{
		ID: created.ID, Name: created.Name, Host: created.Host, Port: created.Port, Username: created.Username,
		AuthMethod: model.AuthPassword, Password: "plain-secret", KeepAlive: 30, TermType: "xterm",
	}))

	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrVaultLocked))
	stored, getErr := store.GetSession(db, created.ID)
	require.NoError(t, getErr)
	assert.Empty(t, stored.Password)
}

func TestSessionServiceImportWithoutCryptoDoesNotPersistPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	path := writeSessionCSVFixture(t, []map[string]string{
		csvFixtureRow(map[string]string{"name": "locked-import", "password": "plain-secret"}),
	})

	summary, err := service.ImportCSV(path, model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})

	require.NoError(t, err)
	assert.Equal(t, 1, summary.Failed)
	assert.Zero(t, summary.Imported)
	assertTableHasNoSessionPassword(t, db)
}

func TestSessionServiceExportWithoutCryptoRejectsPasswordDisclosure(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	created, err := store.CreateSession(db, model.Session{
		Name: "locked-export", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: testStoredSessionPassword(t, "secret"), KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	path := t.TempDir() + "/sessions.csv"
	service.SetPasswordVerifier(staticPasswordVerifier("application-password"))

	_, err = service.ExportCSV(path, model.SessionCSVExportOptions{
		SessionIDs: []int64{created.ID}, IncludePasswords: true, ConfirmPassword: "application-password",
	})

	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrVaultLocked))
}

func TestSessionServiceConnectWithoutCryptoRejectsStoredPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	created, err := store.CreateSession(db, model.Session{
		Name: "locked-connect", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: testStoredSessionPassword(t, "secret"), KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	_, err = service.sessionForConnect(created.ID)

	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrVaultLocked))
}

func assertTableHasNoSessionPassword(t *testing.T, db *sql.DB) {
	t.Helper()
	var count int
	row := db.QueryRow("SELECT COUNT(*) FROM sessions WHERE password IS NOT NULL AND password != ''")
	require.NoError(t, row.Scan(&count))
	assert.Zero(t, count)
}
