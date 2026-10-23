package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSessionStartupCommandPersistsAndMigrates(t *testing.T) {
	db := setupTestDB(t)
	created, err := CreateSession(db, model.Session{
		Name: "startup", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent,
		StartupCommand: "cd /srv/app && ./run.sh", KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	assert.Equal(t, "cd /srv/app && ./run.sh", created.StartupCommand)

	_, err = db.Exec("ALTER TABLE sessions DROP COLUMN startup_command")
	require.NoError(t, err)
	require.NoError(t, InitializeSchema(db))
	require.NoError(t, InitializeSchema(db))
	loaded, err := GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Empty(t, loaded.StartupCommand)

	loaded.StartupCommand = "tmux new -A -s main"
	require.NoError(t, UpdateSession(db, *loaded))
	require.NoError(t, InitializeSchema(db))
	updated, err := GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, "tmux new -A -s main", updated.StartupCommand)
}

func TestSessionStartupCommandSchemaReportsInspectionErrors(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	tx, err := db.Begin()
	require.NoError(t, err)
	require.ErrorContains(t, initializeSessionStartupCommandSchema(tx), "add startup_command")
	require.NoError(t, tx.Rollback())
	require.ErrorContains(t, initializeSessionStartupCommandSchema(tx), "inspect session columns")
}
