package store

import (
	"database/sql"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
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
	var foreignKeys int
	require.NoError(t, db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys))
	assert.Equal(t, 1, foreignKeys)
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

func TestMigrateLegacyFoldersCreatesDefaultAndAssignsSessions(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.Exec(`CREATE TABLE session_folders (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TABLE sessions (id INTEGER PRIMARY KEY, folder_id INTEGER, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, auth_method TEXT NOT NULL, password TEXT, key_id INTEGER, keep_alive INTEGER NOT NULL, term_type TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO session_folders (id, name) VALUES (7, '历史分组')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO sessions (id, name, host, port, username, auth_method, keep_alive, term_type) VALUES (3, '旧会话', '127.0.0.1', 22, 'root', 'password', 30, 'xterm')")
	require.NoError(t, err)
	require.NoError(t, Migrate(db))

	var defaultID, sessionFolderID int64
	require.NoError(t, db.QueryRow("SELECT id FROM session_folders WHERE is_default = 1").Scan(&defaultID))
	require.NoError(t, db.QueryRow("SELECT folder_id FROM sessions WHERE id = 3").Scan(&sessionFolderID))
	assert.Equal(t, int64(7), defaultID)
	assert.Equal(t, defaultID, sessionFolderID)
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
		"macros", "themes", "terminal_theme_profiles", "settings", "session_logs",
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

func TestMigrateAddsSessionRecencyColumns(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, Migrate(db))
	assertTableColumns(t, tableColumnExpectation{db: db, table: "sessions", expected: []string{"last_connected_at", "connection_count"}})
}

type tableColumnExpectation struct {
	db interface {
		Query(string, ...any) (*sql.Rows, error)
	}
	table    string
	expected []string
}

func assertTableColumns(t *testing.T, expectation tableColumnExpectation) {
	t.Helper()
	rows, err := expectation.db.Query("PRAGMA table_info(" + expectation.table + ")")
	require.NoError(t, err)
	defer func() { require.NoError(t, rows.Close()) }()
	columns := make(map[string]bool)
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		require.NoError(t, rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey))
		columns[name] = true
	}
	for _, name := range expectation.expected {
		assert.True(t, columns[name], "missing %s.%s", expectation.table, name)
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

func TestDefaultFolderMigrationHelpersClosedDB(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, db.Close())
	_, err = folderDefaultColumnExists(db)
	assert.Error(t, err)
	_, err = resolveDefaultFolderID(db)
	assert.Error(t, err)
	assert.Error(t, ensureDefaultFolderSchema(db))
}

func TestStoreOperationsClosedDB(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := OpenDB(tmpDir)
	require.NoError(t, err)
	_ = Migrate(db)
	require.NoError(t, db.Close())

	assertClosedFolderOperations(t, db)
	assertClosedSessionOperations(t, db)
	assertClosedSettingOperations(t, db)
	assertClosedKeyOperations(t, db)
	assertClosedTunnelOperations(t, db)
	assertClosedMacroOperations(t, db)
	assertClosedThemeOperations(t, db)
}

func assertClosedFolderOperations(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := CreateFolder(db, "test", ptrInt64(1))
	assert.Error(t, err)
	_, err = ListFolders(db)
	assert.Error(t, err)
	assert.Error(t, UpdateFolder(db, 1, "test"))
	assert.Error(t, DeleteFolder(db, 1))
	assert.Error(t, MoveFolder(db, 1, ptrInt64(2)))
}

func assertClosedSessionOperations(t *testing.T, db *sql.DB) {
	t.Helper()
	s := model.Session{
		Name: "s", Host: "1.1.1.1", Port: 22, Username: "u",
		AuthMethod: model.AuthPassword, Password: "p", KeepAlive: 30,
	}
	_, err := CreateSession(db, s)
	assert.Error(t, err)
	_, err = ListSessions(db, nil)
	assert.Error(t, err)
	assert.Error(t, UpdateSession(db, s))
	assert.Error(t, DeleteSession(db, 1))
	_, err = GetSession(db, 1)
	assert.Error(t, err)
	assert.Error(t, MoveSession(db, 1, ptrInt64(2)))
}

func assertClosedSettingOperations(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := GetSetting(db, "key")
	assert.Error(t, err)
	assert.Error(t, SetSetting(db, "key", "val"))
}

func assertClosedKeyOperations(t *testing.T, db *sql.DB) {
	t.Helper()
	k := model.SSHKey{Name: "k", Type: model.KeyTypeED25519, PrivateKey: "priv"}
	_, err := CreateKey(db, k)
	assert.Error(t, err)
	_, err = ListKeys(db)
	assert.Error(t, err)
	_, err = GetKey(db, 1)
	assert.Error(t, err)
	assert.Error(t, DeleteKey(db, 1))
}

func assertClosedTunnelOperations(t *testing.T, db *sql.DB) {
	t.Helper()
	tun := model.Tunnel{SessionID: 1, Name: "t", Type: model.TunnelLocal, LocalPort: 8080}
	_, err := CreateTunnel(db, tun)
	assert.Error(t, err)
	_, err = ListTunnels(db)
	assert.Error(t, err)
	assert.Error(t, UpdateTunnel(db, tun))
	assert.Error(t, DeleteTunnel(db, 1))
}

func assertClosedMacroOperations(t *testing.T, db *sql.DB) {
	t.Helper()
	mac := model.Macro{Name: "m", Command: "c"}
	_, err := CreateMacro(db, mac)
	assert.Error(t, err)
	_, err = ListMacros(db)
	assert.Error(t, err)
	assert.Error(t, UpdateMacro(db, mac))
	assert.Error(t, DeleteMacro(db, 1))
}

func assertClosedThemeOperations(t *testing.T, db *sql.DB) {
	t.Helper()
	th := model.ThemeDefinition{Name: "t", Mode: model.ThemeModeDark, SourceType: model.ThemeSourceCustom, SourceFingerprint: "closed", ColorPayload: "{}"}
	_, err := CreateThemeDefinition(db, th)
	assert.Error(t, err)
	_, err = ListThemeDefinitions(db, "")
	assert.Error(t, err)
	_, err = GetThemeDefinition(db, 1)
	assert.Error(t, err)
	assert.Error(t, DeleteThemeDefinition(db, 1))
}

func ptrInt64(v int64) *int64 {
	return &v
}
