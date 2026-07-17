package store

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const databaseFormatVersion = 4

const foldersTableSQL = `CREATE TABLE IF NOT EXISTS session_folders (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	parent_id INTEGER REFERENCES session_folders(id),
	is_default INTEGER NOT NULL DEFAULT 0,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const keysTableSQL = `CREATE TABLE IF NOT EXISTS ssh_keys (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK(type IN ('rsa','ed25519','ecdsa')),
	private_key TEXT NOT NULL,
	public_key TEXT,
	has_passphrase INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const sessionsTableSQL = `CREATE TABLE IF NOT EXISTS sessions (
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
)`

const tunnelsTableSQL = `CREATE TABLE IF NOT EXISTS tunnels (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions(id),
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK(type IN ('local','remote','dynamic')),
	local_host TEXT,
	local_port INTEGER,
	remote_host TEXT,
	remote_port INTEGER,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const macrosTableSQL = `CREATE TABLE IF NOT EXISTS macros (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	command TEXT NOT NULL,
	shortcut TEXT,
	delay_ms INTEGER NOT NULL DEFAULT 0,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const commandHistoryTableSQL = `CREATE TABLE IF NOT EXISTS command_history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	command TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const logsTableSQL = `CREATE TABLE IF NOT EXISTS session_logs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER REFERENCES sessions(id),
	started_at TEXT NOT NULL,
	ended_at TEXT,
	data_path TEXT NOT NULL
)`

const transferJobsTableSQL = `CREATE TABLE IF NOT EXISTS transfer_jobs (
	id TEXT PRIMARY KEY,
	session_id INTEGER NOT NULL,
	session_name TEXT NOT NULL,
	direction TEXT NOT NULL CHECK(direction IN ('upload','download')),
	source_path TEXT NOT NULL,
	target_path TEXT NOT NULL,
	total_bytes INTEGER NOT NULL DEFAULT 0,
	transferred_bytes INTEGER NOT NULL DEFAULT 0,
	speed INTEGER NOT NULL DEFAULT 0,
	eta INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
	error TEXT NOT NULL DEFAULT '',
	started_at TEXT NOT NULL,
	completed_at TEXT
)`

const auditEventsTableSQL = `CREATE TABLE IF NOT EXISTS audit_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	action TEXT NOT NULL,
	target_type TEXT NOT NULL,
	target_id TEXT NOT NULL DEFAULT '',
	session_id INTEGER,
	summary TEXT NOT NULL,
	outcome TEXT NOT NULL CHECK(outcome IN ('success','failed')),
	created_at TEXT NOT NULL
)`

type schemaStatement struct {
	name string
	sql  string
}

var finalSchemaStatements = []schemaStatement{
	{name: "session_folders", sql: foldersTableSQL},
	{name: "ssh_keys", sql: keysTableSQL},
	{name: "sessions", sql: sessionsTableSQL},
	{name: "tunnels", sql: tunnelsTableSQL},
	{name: "macros", sql: macrosTableSQL},
	{name: "command_history", sql: commandHistoryTableSQL},
	{name: "session_logs", sql: logsTableSQL},
	{name: "transfer_jobs", sql: transferJobsTableSQL},
	{name: "audit_events", sql: auditEventsTableSQL},
	{name: "audit_events_action_idx", sql: "CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events(action, created_at DESC)"},
	{name: "audit_events_session_idx", sql: "CREATE INDEX IF NOT EXISTS audit_events_session_idx ON audit_events(session_id, created_at DESC)"},
	{name: "settings", sql: settingsTableSQL},
	{name: "themes", sql: themeDefinitionsSchema},
	{name: "terminal_theme_profiles", sql: themeProfilesSchema},
}

var applicationTablesInDropOrder = []string{
	"terminal_theme_profiles",
	"themes",
	"session_logs",
	"transfer_jobs",
	"audit_events",
	"tunnels",
	"sessions",
	"ssh_keys",
	"session_folders",
	"settings",
	"macros",
	"command_history",
}

type dbFile interface {
	Chmod(mode fs.FileMode) error
	Close() error
}

type dbOpenDependencies struct {
	mkdirAll func(string, fs.FileMode) error
	chmod    func(string, fs.FileMode) error
	openFile func(string, int, fs.FileMode) (dbFile, error)
	sqlOpen  func(string, string) (*sql.DB, error)
	ping     func(*sql.DB) error
	closeDB  func(*sql.DB) error
}

func OpenDB(dataDir string) (*sql.DB, error) {
	return openDBWithDependencies(dataDir, defaultDBOpenDependencies())
}

func defaultDBOpenDependencies() dbOpenDependencies {
	return dbOpenDependencies{
		mkdirAll: os.MkdirAll,
		chmod:    os.Chmod,
		openFile: func(path string, flag int, mode fs.FileMode) (dbFile, error) {
			return os.OpenFile(path, flag, mode)
		},
		sqlOpen: sql.Open,
		ping:    func(db *sql.DB) error { return db.Ping() },
		closeDB: func(db *sql.DB) error { return db.Close() },
	}
}

func openDBWithDependencies(dataDir string, dependencies dbOpenDependencies) (*sql.DB, error) {
	if err := dependencies.mkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	if err := dependencies.chmod(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("secure data directory: %w", err)
	}
	dbPath := filepath.Join(dataDir, "mssh.db")
	file, err := dependencies.openFile(dbPath, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open database file: %w", err)
	}
	if err = file.Chmod(0o600); err != nil {
		return nil, errors.Join(fmt.Errorf("secure database file: %w", err), closeDBFile(file))
	}
	if err = file.Close(); err != nil {
		return nil, fmt.Errorf("close database file: %w", err)
	}
	dsn := dbPath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate"
	db, err := dependencies.sqlOpen("sqlite", dsn)
	if err != nil {
		return nil, errors.Join(fmt.Errorf("open database: %w", err), closeOpenedDB(db, dependencies.closeDB))
	}
	db.SetMaxOpenConns(1)
	if err = dependencies.ping(db); err != nil {
		return nil, errors.Join(fmt.Errorf("ping database: %w", err), closeOpenedDB(db, dependencies.closeDB))
	}
	return db, nil
}

func closeDBFile(file dbFile) error {
	if err := file.Close(); err != nil {
		return fmt.Errorf("close database file: %w", err)
	}
	return nil
}

func closeOpenedDB(db *sql.DB, closeDB func(*sql.DB) error) error {
	if db == nil {
		return nil
	}
	if err := closeDB(db); err != nil {
		return fmt.Errorf("close database: %w", err)
	}
	return nil
}

func InitializeSchema(db *sql.DB) error {
	return initializeSchema(db, databaseFormatVersion, setDatabaseVersion)
}

func initializeSchema(db *sql.DB, targetVersion int, setVersion func(*sql.Tx, int) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("initialize schema: begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	currentVersion, err := databaseVersion(tx)
	if err != nil {
		return fmt.Errorf("initialize schema: read format version: %w", err)
	}
	if currentVersion != targetVersion {
		if err = dropApplicationTables(tx); err != nil {
			return err
		}
	}
	if err = createFinalSchema(tx); err != nil {
		return err
	}
	if err = initializeDefaultFolder(tx); err != nil {
		return err
	}
	if currentVersion != targetVersion {
		if err = setVersion(tx, targetVersion); err != nil {
			return fmt.Errorf("initialize schema: set format version: %w", err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("initialize schema: commit transaction: %w", err)
	}
	return nil
}

func databaseVersion(tx *sql.Tx) (int, error) {
	var version int
	if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return 0, err
	}
	return version, nil
}

func dropApplicationTables(tx *sql.Tx) error {
	for _, table := range applicationTablesInDropOrder {
		if _, err := tx.Exec("DROP TABLE IF EXISTS " + table); err != nil {
			return fmt.Errorf("initialize schema: drop %s: %w", table, err)
		}
	}
	return nil
}

func createFinalSchema(tx *sql.Tx) error {
	for _, statement := range finalSchemaStatements {
		if _, err := tx.Exec(statement.sql); err != nil {
			return fmt.Errorf("initialize schema: create %s schema: %w", statement.name, err)
		}
	}
	return nil
}

func setDatabaseVersion(tx *sql.Tx, version int) error {
	_, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", version))
	return err
}

func initializeDefaultFolder(tx *sql.Tx) error {
	var defaultID int64
	err := tx.QueryRow("SELECT id FROM session_folders ORDER BY is_default DESC, id LIMIT 1").Scan(&defaultID)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("initialize schema: find default folder: %w", err)
	}
	if err == sql.ErrNoRows {
		result, insertErr := tx.Exec("INSERT INTO session_folders (name, is_default) VALUES ('默认分组', 1)")
		if insertErr != nil {
			return fmt.Errorf("initialize schema: create default folder: %w", insertErr)
		}
		defaultID, insertErr = result.LastInsertId()
		if insertErr != nil {
			return fmt.Errorf("initialize schema: read default folder id: %w", insertErr)
		}
	}
	if _, err = tx.Exec("UPDATE session_folders SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END", defaultID); err != nil {
		return fmt.Errorf("initialize schema: select default folder: %w", err)
	}
	if _, err = tx.Exec("UPDATE sessions SET folder_id = ? WHERE folder_id IS NULL", defaultID); err != nil {
		return fmt.Errorf("initialize schema: assign default folder: %w", err)
	}
	return nil
}
