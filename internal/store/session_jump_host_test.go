package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSessionJumpHostPersistsAcrossQueries(t *testing.T) {
	db := setupTestDB(t)
	input := model.Session{Name: "internal", Host: "10.0.0.1", Port: 22, Username: "target", AuthMethod: model.AuthPassword,
		JumpHost: &model.SSHJumpHost{Host: "bastion.example", Port: 2222, Username: "jump", AuthMethod: model.AuthPassword, Password: "encrypted-jump"}}
	created, err := CreateSession(db, input)
	require.NoError(t, err)
	require.Equal(t, input.JumpHost, created.JumpHost)
	for _, folderID := range []*int64{nil, created.FolderID} {
		sessions, listErr := ListSessions(db, folderID)
		require.NoError(t, listErr)
		require.Len(t, sessions, 1)
		assert.Equal(t, input.JumpHost, sessions[0].JumpHost)
	}
	require.NoError(t, MarkSessionConnected(db, created.ID))
	recent, err := ListRecentSessions(db, 10)
	require.NoError(t, err)
	require.Len(t, recent, 1)
	assert.Equal(t, input.JumpHost, recent[0].JumpHost)
	created.JumpHost.Port = 2200
	require.NoError(t, UpdateSession(db, *created))
	updated, err := GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, 2200, updated.JumpHost.Port)
	updated.JumpHost = nil
	require.NoError(t, UpdateSession(db, *updated))
	disabled, err := GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Nil(t, disabled.JumpHost)
	var host, username, password string
	require.NoError(t, db.QueryRow("SELECT jump_host, jump_username, jump_password FROM sessions WHERE id = ?", created.ID).Scan(&host, &username, &password))
	assert.Empty(t, host)
	assert.Empty(t, username)
	assert.Empty(t, password)
}

func TestSessionJumpHostReferencesKeys(t *testing.T) {
	db := setupTestDB(t)
	key, err := CreateKey(db, model.SSHKey{Name: "jump-key", Type: model.KeyTypeED25519, PrivateKey: "encrypted"})
	require.NoError(t, err)
	input := model.Session{Name: "internal", Host: "10.0.0.1", Port: 22, Username: "target", AuthMethod: model.AuthAgent,
		JumpHost: &model.SSHJumpHost{Host: "bastion.example", Port: 22, Username: "jump", AuthMethod: model.AuthKey, KeyID: &key.ID}}
	created, err := CreateSession(db, input)
	require.NoError(t, err)
	assert.Equal(t, key.ID, *created.JumpHost.KeyID)
	require.Error(t, DeleteKey(db, key.ID))
	missingID := key.ID + 1
	input.JumpHost.KeyID = &missingID
	_, err = CreateSession(db, input)
	require.Error(t, err)
	created.JumpHost = nil
	require.NoError(t, UpdateSession(db, *created))
	require.NoError(t, DeleteKey(db, key.ID))
}

func TestSessionJumpHostMigrationPreservesDirectSessions(t *testing.T) {
	db := setupTestDB(t)
	created, err := CreateSession(db, model.Session{Name: "existing", Host: "host.example", Port: 22, Username: "user", AuthMethod: model.AuthAgent})
	require.NoError(t, err)
	for _, column := range []string{"jump_host", "jump_port", "jump_username", "jump_auth_method", "jump_password", "jump_key_id"} {
		_, dropErr := db.Exec("ALTER TABLE sessions DROP COLUMN " + column)
		require.NoError(t, dropErr)
	}
	require.NoError(t, InitializeSchema(db))
	require.NoError(t, InitializeSchema(db))
	loaded, err := GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.Name, loaded.Name)
	assert.Nil(t, loaded.JumpHost)
	var port int
	var method, password string
	require.NoError(t, db.QueryRow("SELECT jump_port, jump_auth_method, jump_password FROM sessions WHERE id = ?", loaded.ID).Scan(&port, &method, &password))
	assert.Equal(t, 22, port)
	assert.Equal(t, "password", method)
	assert.Empty(t, password)
}

func TestSessionJumpHostSchemaReportsTransactionAndMissingTableErrors(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	tx, err := db.Begin()
	require.NoError(t, err)
	require.ErrorContains(t, initializeSessionJumpHostSchema(tx), "add jump_host")
	require.NoError(t, tx.Rollback())
	require.ErrorContains(t, initializeSessionJumpHostSchema(tx), "inspect session columns")
}

func TestSessionJumpHostMigrationFailureRollsBackSchemaInitialization(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.Exec("CREATE VIEW sessions AS SELECT 1 AS id")
	require.NoError(t, err)
	require.ErrorContains(t, InitializeSchema(db), "SSH jump host")
	var tables int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'ssh_keys'").Scan(&tables))
	assert.Zero(t, tables)
}
