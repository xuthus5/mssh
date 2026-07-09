package store

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
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

func TestStoreOperationsClosedDB(t *testing.T) { //nolint:funlen
	tmpDir := t.TempDir()
	db, err := OpenDB(tmpDir)
	require.NoError(t, err)
	_ = Migrate(db)
	db.Close()

	{
		var pid int64 = 1
		_, err = CreateFolder(db, "test", &pid)
		assert.Error(t, err)
	}
	{
		_, err = ListFolders(db)
		assert.Error(t, err)
	}
	{
		err = UpdateFolder(db, 1, "test")
		assert.Error(t, err)
	}
	{
		err = DeleteFolder(db, 1)
		assert.Error(t, err)
	}
	{
		err = MoveFolder(db, 1, ptrInt64(2))
		assert.Error(t, err)
	}
	s := model.Session{
		Name: "s", Host: "1.1.1.1", Port: 22, Username: "u",
		AuthMethod: model.AuthPassword, Password: "p", KeepAlive: 30,
	}
	{
		_, err = CreateSession(db, s)
		assert.Error(t, err)
	}
	{
		_, err = ListSessions(db, nil)
		assert.Error(t, err)
	}
	{
		err = UpdateSession(db, s)
		assert.Error(t, err)
	}
	{
		err = DeleteSession(db, 1)
		assert.Error(t, err)
	}
	{
		_, err = GetSession(db, 1)
		assert.Error(t, err)
	}
	{
		err = MoveSession(db, 1, ptrInt64(2))
		assert.Error(t, err)
	}
	{
		_, err = GetSetting(db, "key")
		assert.Error(t, err)
	}
	{
		err = SetSetting(db, "key", "val")
		assert.Error(t, err)
	}
	k := model.SSHKey{Name: "k", Type: model.KeyTypeED25519, PrivateKey: "priv"}
	{
		_, err = CreateKey(db, k)
		assert.Error(t, err)
	}
	{
		_, err = ListKeys(db)
		assert.Error(t, err)
	}
	{
		_, err = GetKey(db, 1)
		assert.Error(t, err)
	}
	{
		err = DeleteKey(db, 1)
		assert.Error(t, err)
	}
	tun := model.Tunnel{SessionID: 1, Name: "t", Type: model.TunnelLocal, LocalPort: 8080}
	{
		_, err = CreateTunnel(db, tun)
		assert.Error(t, err)
	}
	{
		_, err = ListTunnels(db)
		assert.Error(t, err)
	}
	{
		err = UpdateTunnel(db, tun)
		assert.Error(t, err)
	}
	{
		err = DeleteTunnel(db, 1)
		assert.Error(t, err)
	}
	mac := model.Macro{Name: "m", Command: "c"}
	{
		_, err = CreateMacro(db, mac)
		assert.Error(t, err)
	}
	{
		_, err = ListMacros(db)
		assert.Error(t, err)
	}
	{
		err = UpdateMacro(db, mac)
		assert.Error(t, err)
	}
	{
		err = DeleteMacro(db, 1)
		assert.Error(t, err)
	}
	th := model.Theme{Name: "t", Config: "{}"}
	{
		_, err = CreateTheme(db, th)
		assert.Error(t, err)
	}
	{
		_, err = ListThemes(db)
		assert.Error(t, err)
	}
	{
		err = UpdateTheme(db, th)
		assert.Error(t, err)
	}
	{
		err = DeleteTheme(db, 1)
		assert.Error(t, err)
	}
}

func ptrInt64(v int64) *int64 {
	return &v
}
