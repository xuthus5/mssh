package app

import (
	"database/sql"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/store"
)

func TestNewInitializesFinalDatabaseFormat(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))

	appInstance, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)
	t.Cleanup(appInstance.Shutdown)

	var version int
	require.NoError(t, appInstance.DB.QueryRow("PRAGMA user_version").Scan(&version))
	assert.Equal(t, store.DatabaseFormatVersion(), version)

	var defaultFolders int
	require.NoError(t, appInstance.DB.QueryRow("SELECT count(*) FROM session_folders WHERE is_default = 1").Scan(&defaultFolders))
	assert.Equal(t, 1, defaultFolders)
}

func TestNewRejectsLegacyDatabaseWithoutFormatVersion(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	db, err := store.OpenDB(dataDir)
	require.NoError(t, err)
	_, err = db.Exec("CREATE TABLE sessions (name TEXT NOT NULL)")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO sessions VALUES ('legacy-sentinel')")
	require.NoError(t, err)
	require.NoError(t, db.Close())

	_, err = New(Options{DataDir: dataDir})
	require.ErrorContains(t, err, "legacy database")
}

func TestNewClosesDatabaseWhenSchemaInitializationFails(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	db, err := store.OpenDB(dataDir)
	require.NoError(t, err)
	_, err = db.Exec("CREATE VIEW session_folders AS SELECT 1 AS id")
	require.NoError(t, err)
	openDB := func(string) (*sql.DB, error) { return db, nil }

	_, err = newApp(Options{DataDir: dataDir, Logger: slog.Default()}, openDB)
	require.ErrorContains(t, err, "initialize database schema")
	require.Error(t, db.Ping())

	reopened, err := store.OpenDB(dataDir)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, reopened.Close()) })
	var journalMode string
	require.NoError(t, reopened.QueryRow("PRAGMA journal_mode = DELETE").Scan(&journalMode))
	assert.Equal(t, "delete", journalMode)
}

func TestNewReturnsDatabaseOpenError(t *testing.T) {
	openDB := func(string) (*sql.DB, error) { return nil, assert.AnError }

	appInstance, err := newApp(Options{DataDir: t.TempDir(), Logger: slog.Default()}, openDB)

	assert.Nil(t, appInstance)
	require.ErrorContains(t, err, "open database")
}
