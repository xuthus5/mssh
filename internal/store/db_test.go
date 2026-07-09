package store

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenDB(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := OpenDB(tmpDir)
	require.NoError(t, err)
	defer db.Close()
	assert.NotNil(t, db)
	err = db.Ping()
	assert.NoError(t, err)

	var journalMode string
	err = db.QueryRow("PRAGMA journal_mode").Scan(&journalMode)
	require.NoError(t, err)
	assert.Equal(t, "wal", journalMode)
}

func TestMigrate(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := OpenDB(tmpDir)
	require.NoError(t, err)
	defer db.Close()
	err = Migrate(db)
	require.NoError(t, err)
	err = Migrate(db)
	require.NoError(t, err)
}

func TestMigrateTablesExist(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := OpenDB(tmpDir)
	require.NoError(t, err)
	defer db.Close()
	err = Migrate(db)
	require.NoError(t, err)
	expected := []string{
		"session_folders", "sessions", "ssh_keys", "tunnels",
		"macros", "themes", "settings", "session_logs",
	}
	for _, table := range expected {
		var count int
		err := db.QueryRow(
			"SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?",
			table,
		).Scan(&count)
		require.NoError(t, err)
		assert.Equal(t, 1, count, "table %s should exist", table)
	}
}

func TestOpenDBInvalidPath(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := tmpDir + "/file.txt"
	err := os.WriteFile(filePath, []byte("data"), 0o600)
	require.NoError(t, err)

	db, err := OpenDB(filePath)
	require.NoError(t, err)
	defer db.Close()
	err = db.Ping()
	assert.Error(t, err)
}

func TestMigrateClosedDB(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := OpenDB(tmpDir)
	require.NoError(t, err)
	db.Close()
	err = Migrate(db)
	assert.Error(t, err)
}
