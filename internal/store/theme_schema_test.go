package store

import (
	"database/sql"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var expectedFinalSchemaSQL = map[string]string{
	"session_folders": `CREATE TABLE session_folders (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		parent_id INTEGER REFERENCES session_folders(id),
		is_default INTEGER NOT NULL DEFAULT 0,
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	"ssh_keys": `CREATE TABLE ssh_keys (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		type TEXT NOT NULL CHECK(type IN ('rsa','ed25519','ecdsa')),
		private_key TEXT NOT NULL,
		public_key TEXT,
		has_passphrase INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	"sessions": `CREATE TABLE sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		folder_id INTEGER REFERENCES session_folders(id),
		name TEXT NOT NULL,
		host TEXT NOT NULL,
		port INTEGER NOT NULL DEFAULT 22,
		username TEXT NOT NULL,
		tags TEXT NOT NULL DEFAULT '',
		notes TEXT NOT NULL DEFAULT '',
		environment TEXT NOT NULL DEFAULT '',
		project TEXT NOT NULL DEFAULT '',
		auth_method TEXT NOT NULL CHECK(auth_method IN ('password','key','agent','keyboard-interactive')),
		password TEXT,
		key_id INTEGER REFERENCES ssh_keys(id),
		keep_alive INTEGER NOT NULL DEFAULT 30,
		term_type TEXT NOT NULL DEFAULT 'xterm-256color',
		sort_order INTEGER NOT NULL DEFAULT 0,
		last_connected_at TEXT,
		connection_count INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	"tunnels": `CREATE TABLE tunnels (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id INTEGER NOT NULL REFERENCES sessions(id),
		name TEXT NOT NULL,
		type TEXT NOT NULL CHECK(type IN ('local','remote','dynamic')),
		local_host TEXT,
		local_port INTEGER,
		remote_host TEXT,
		remote_port INTEGER,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	"macros": `CREATE TABLE macros (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		command TEXT NOT NULL,
		shortcut TEXT,
		delay_ms INTEGER NOT NULL DEFAULT 0,
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	"session_logs": `CREATE TABLE session_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id INTEGER REFERENCES sessions(id),
		started_at TEXT NOT NULL,
		ended_at TEXT,
		data_path TEXT NOT NULL
	)`,
	"settings": `CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		namespace TEXT NOT NULL,
		value TEXT NOT NULL,
		value_type TEXT NOT NULL CHECK(value_type IN ('string','number','boolean','array','object','null')),
		version INTEGER NOT NULL DEFAULT 1,
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	"themes": `CREATE TABLE themes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		mode TEXT NOT NULL CHECK(mode IN ('dark', 'light', 'universal')),
		source_type TEXT NOT NULL CHECK(source_type IN ('builtin', 'iterm2', 'community', 'custom')),
		source_name TEXT NOT NULL DEFAULT '',
		source_url TEXT NOT NULL DEFAULT '',
		source_author TEXT NOT NULL DEFAULT '',
		source_license TEXT NOT NULL DEFAULT '',
		source_version TEXT NOT NULL DEFAULT '',
		source_fingerprint TEXT NOT NULL UNIQUE,
		color_payload TEXT NOT NULL,
		raw_payload TEXT NOT NULL DEFAULT '',
		is_builtin INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	"terminal_theme_profiles": `CREATE TABLE terminal_theme_profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE RESTRICT,
		follow_global_style INTEGER NOT NULL DEFAULT 1,
		font_family TEXT NOT NULL,
		font_size INTEGER NOT NULL,
		cursor_style TEXT NOT NULL CHECK(cursor_style IN ('block', 'underline', 'bar')),
		color_overrides TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
}

func TestFinalDatabaseSchemaSQL(t *testing.T) {
	db := setupTestDB(t)
	assertFinalSchema(t, db)
}

func TestThemeCatalogSchema(t *testing.T) {
	db := setupTestDB(t)
	_, err := db.Exec("INSERT INTO themes (name, mode, source_type, source_fingerprint, color_payload) VALUES ('A', 'dark', 'custom', 'same', '{}'), ('B', 'light', 'custom', 'same', '{}')")
	assert.Error(t, err)
}

func TestDatabaseFormatUsesTargetVersion(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	require.NoError(t, initializeSchema(db, 7, setDatabaseVersion))

	assertDatabaseFormatVersion(t, db, 7)
}

func TestDatabaseFormatVersionFailureRollsBack(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	createLegacySentinels(t, db)
	setVersion := func(*sql.Tx, int) error { return assert.AnError }

	err = initializeSchema(db, databaseFormatVersion, setVersion)
	require.ErrorContains(t, err, "set format version")

	assertTableRowCount(t, rowCountExpectation{db: db, table: "themes", condition: "legacy_sentinel = 'themes-sentinel'", expected: 1})
	assertDatabaseFormatVersion(t, db, 0)
}

func TestInitializeSchemaCreateStageRollsBack(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	tx, err := db.Begin()
	require.NoError(t, err)
	require.NoError(t, setDatabaseVersion(tx, databaseFormatVersion))
	require.NoError(t, tx.Commit())
	originalStatements := finalSchemaStatements
	finalSchemaStatements = append([]schemaStatement(nil), finalSchemaStatements...)
	t.Cleanup(func() { finalSchemaStatements = originalStatements })
	for index := range finalSchemaStatements {
		if finalSchemaStatements[index].name == "settings" {
			finalSchemaStatements[index].sql = "CREATE TABLE settings ("
		}
	}

	err = InitializeSchema(db)
	require.ErrorContains(t, err, "settings")

	assertSQLiteObjectCount(t, sqliteObjectCountExpectation{db: db, objectType: "table", name: "session_folders", expected: 0})
	assertSQLiteObjectCount(t, sqliteObjectCountExpectation{db: db, objectType: "table", name: "settings", expected: 0})
}

func TestInitializeSchemaDefaultFolderStageRollsBack(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, InitializeSchema(db))
	_, err = db.Exec("DELETE FROM session_folders")
	require.NoError(t, err)
	_, err = db.Exec("DROP TABLE settings")
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TRIGGER reject_default_folder BEFORE INSERT ON session_folders BEGIN SELECT RAISE(ABORT, 'blocked'); END`)
	require.NoError(t, err)

	err = InitializeSchema(db)
	require.ErrorContains(t, err, "create default folder")

	assertSQLiteObjectCount(t, sqliteObjectCountExpectation{db: db, objectType: "table", name: "settings", expected: 0})
	assertTableRowCount(t, rowCountExpectation{db: db, table: "session_folders", expected: 0})
}

func createLegacySentinels(t *testing.T, db *sql.DB) {
	t.Helper()
	for table := range expectedFinalSchemaSQL {
		_, err := db.Exec("CREATE TABLE " + table + " (legacy_sentinel TEXT NOT NULL)")
		require.NoError(t, err)
		_, err = db.Exec("INSERT INTO "+table+" VALUES (?)", table+"-sentinel")
		require.NoError(t, err)
	}
}

func assertFinalSchema(t *testing.T, db *sql.DB) {
	t.Helper()
	for table, expected := range expectedFinalSchemaSQL {
		var actual string
		require.NoError(t, db.QueryRow("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", table).Scan(&actual))
		assert.Equal(t, normalizeSchemaSQL(expected), normalizeSchemaSQL(actual), "schema mismatch for %s", table)
	}
}

func normalizeSchemaSQL(value string) string {
	value = strings.Replace(value, "CREATE TABLE IF NOT EXISTS", "CREATE TABLE", 1)
	return strings.Join(strings.Fields(value), " ")
}

type sqliteObjectCountExpectation struct {
	db         *sql.DB
	objectType string
	name       string
	expected   int
}

func assertSQLiteObjectCount(t *testing.T, expectation sqliteObjectCountExpectation) {
	t.Helper()
	var actual int
	require.NoError(t, expectation.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type = ? AND name = ?", expectation.objectType, expectation.name).Scan(&actual))
	assert.Equal(t, expectation.expected, actual)
}
