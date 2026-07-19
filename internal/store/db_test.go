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
	t.Cleanup(func() { require.NoError(t, db.Close()) })
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

func TestDatabaseFormatVersion(t *testing.T) {
	assert.Equal(t, 5, databaseFormatVersion)
}

func TestListSessionsAcceptsNullPassword(t *testing.T) {
	db := setupTestDB(t)
	_, err := db.Exec(`INSERT INTO sessions (folder_id, name, host, username, auth_method, password) SELECT id, 'agent', '127.0.0.1', 'root', 'agent', NULL FROM session_folders WHERE is_default = 1`)
	require.NoError(t, err)

	sessions, err := ListSessions(db, nil)
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	assert.Empty(t, sessions[0].Password)
}

func TestInitializeSchemaResetsMismatchedDatabaseFormat(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	createLegacySentinels(t, db)

	require.NoError(t, InitializeSchema(db))

	assertFinalSchema(t, db)
	for table := range expectedFinalSchemaSQL {
		expectedRows := 0
		if table == "session_folders" {
			expectedRows = 1
		}
		assertTableRowCount(t, rowCountExpectation{db: db, table: table, expected: expectedRows})
	}
	assertTableRowCount(t, rowCountExpectation{db: db, table: "session_folders", condition: "is_default = 1", expected: 1})
	assertDatabaseFormatVersion(t, db, databaseFormatVersion)
}

func TestInitializeSchemaPreservesCurrentDatabaseFormat(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, InitializeSchema(db))
	_, err = db.Exec(`INSERT INTO sessions (folder_id, name, host, username, auth_method) SELECT id, 'sentinel', '127.0.0.1', 'root', 'agent' FROM session_folders WHERE is_default = 1`)
	require.NoError(t, err)

	require.NoError(t, InitializeSchema(db))

	assertTableRowCount(t, rowCountExpectation{db: db, table: "sessions", condition: "name = 'sentinel'", expected: 1})
	assertTableRowCount(t, rowCountExpectation{db: db, table: "session_folders", condition: "is_default = 1", expected: 1})
}

func TestInitializeSchemaAddsAITablesWithoutReset(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, InitializeSchema(db))
	_, err = db.Exec(`INSERT INTO sessions (folder_id, name, host, username, auth_method) SELECT id, 'sentinel', '127.0.0.1', 'root', 'agent' FROM session_folders WHERE is_default = 1`)
	require.NoError(t, err)
	for _, table := range []string{"ai_command_executions", "ai_messages", "ai_conversations", "ai_settings", "ai_provider_profiles"} {
		_, err = db.Exec("DROP TABLE " + table)
		require.NoError(t, err)
	}
	require.NoError(t, InitializeSchema(db))
	assertTableRowCount(t, rowCountExpectation{db: db, table: "sessions", condition: "name = 'sentinel'", expected: 1})
	assertSQLiteObjectCount(t, sqliteObjectCountExpectation{db: db, objectType: "table", name: "ai_provider_profiles", expected: 1})
}

func TestDatabaseFormatResetRollsBackOnFailure(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.Exec("CREATE TABLE themes (name TEXT NOT NULL)")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO themes (name) VALUES ('sentinel')")
	require.NoError(t, err)
	_, err = db.Exec("CREATE VIEW session_folders AS SELECT 1 AS id")
	require.NoError(t, err)

	require.Error(t, InitializeSchema(db))

	assertTableRowCount(t, rowCountExpectation{db: db, table: "themes", condition: "name = 'sentinel'", expected: 1})
	assertDatabaseFormatVersion(t, db, 0)
}

func assertDatabaseFormatVersion(t *testing.T, db *sql.DB, expected int) {
	t.Helper()
	var actual int
	require.NoError(t, db.QueryRow("PRAGMA user_version").Scan(&actual))
	assert.Equal(t, expected, actual)
}

type rowCountExpectation struct {
	db        *sql.DB
	table     string
	condition string
	expected  int
}

func assertTableRowCount(t *testing.T, expectation rowCountExpectation) {
	t.Helper()
	condition := expectation.condition
	if condition == "" {
		condition = "1 = 1"
	}
	var actual int
	require.NoError(t, expectation.db.QueryRow("SELECT count(*) FROM "+expectation.table+" WHERE "+condition).Scan(&actual))
	assert.Equal(t, expectation.expected, actual)
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
	require.NoError(t, rows.Err())
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
	assert.Nil(t, db)
	assert.Error(t, err)
}

func TestInitializeSchemaClosedDB(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := OpenDB(tmpDir)
	require.NoError(t, err)
	require.NoError(t, db.Close())
	assert.Error(t, InitializeSchema(db))
}

func TestStoreOperationsClosedDB(t *testing.T) {
	tmpDir := t.TempDir()
	db, err := OpenDB(tmpDir)
	require.NoError(t, err)
	require.NoError(t, InitializeSchema(db))
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
	_, err := GetSettingEntry(db, "terminal.key")
	assert.Error(t, err)
	assert.Error(t, SetSettings(db, []model.Setting{{
		Key:       "terminal.key",
		Namespace: "terminal",
		Value:     `"val"`,
		ValueType: "string",
		Version:   1,
	}}))
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
