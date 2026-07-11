package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func OpenDB(dataDir string) (*sql.DB, error) {
	_ = os.MkdirAll(dataDir, 0o700)
	dbPath := filepath.Join(dataDir, "mssh.db")
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	_ = os.Chmod(dbPath, 0o600)
	db.SetMaxOpenConns(1)
	return db, nil
}

func Migrate(db *sql.DB) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS session_folders (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			name       TEXT NOT NULL,
			parent_id  INTEGER REFERENCES session_folders(id),
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			folder_id  INTEGER REFERENCES session_folders(id),
			name       TEXT NOT NULL,
			host       TEXT NOT NULL,
			port       INTEGER NOT NULL DEFAULT 22,
			username   TEXT NOT NULL,
			auth_method TEXT NOT NULL CHECK(auth_method IN ('password','key','agent','keyboard-interactive')),
			password   TEXT,
			key_id     INTEGER REFERENCES ssh_keys(id),
			keep_alive INTEGER NOT NULL DEFAULT 30,
			term_type  TEXT NOT NULL DEFAULT 'xterm-256color',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS ssh_keys (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			name           TEXT NOT NULL,
			type           TEXT NOT NULL CHECK(type IN ('rsa','ed25519','ecdsa')),
			private_key    TEXT NOT NULL,
			public_key     TEXT,
			has_passphrase INTEGER NOT NULL DEFAULT 0,
			created_at     TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS tunnels (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id  INTEGER NOT NULL REFERENCES sessions(id),
			name        TEXT NOT NULL,
			type        TEXT NOT NULL CHECK(type IN ('local','remote','dynamic')),
			local_host  TEXT,
			local_port  INTEGER,
			remote_host TEXT,
			remote_port INTEGER,
			created_at  TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS macros (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			name       TEXT NOT NULL,
			command    TEXT NOT NULL,
			shortcut   TEXT,
			delay_ms   INTEGER NOT NULL DEFAULT 0,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS themes (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			name       TEXT NOT NULL,
			is_builtin INTEGER NOT NULL DEFAULT 0,
			config     TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
		`CREATE TABLE IF NOT EXISTS session_logs (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id INTEGER REFERENCES sessions(id),
			started_at TEXT NOT NULL,
			ended_at   TEXT,
			data_path  TEXT NOT NULL
		)`,
	}
	if err := executeMigrations(db, migrations); err != nil {
		return err
	}
	if err := ensureDefaultFolderSchema(db); err != nil {
		return fmt.Errorf("migration: %w", err)
	}
	if err := ensureSettingsSchema(db); err != nil {
		return fmt.Errorf("migration: %w", err)
	}
	return nil
}

func executeMigrations(db *sql.DB, migrations []string) error {
	for _, migration := range migrations {
		if _, err := db.Exec(migration); err != nil {
			return fmt.Errorf("migration: %w", err)
		}
	}
	return nil
}

func ensureDefaultFolderSchema(db *sql.DB) error {
	hasColumn, err := folderDefaultColumnExists(db)
	if err != nil {
		return err
	}
	if !hasColumn {
		if _, err := db.Exec("ALTER TABLE session_folders ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0"); err != nil {
			return err
		}
	}
	defaultID, err := resolveDefaultFolderID(db)
	if err != nil {
		return err
	}
	if _, err = db.Exec("UPDATE session_folders SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END", defaultID); err != nil {
		return err
	}
	_, err = db.Exec("UPDATE sessions SET folder_id = ? WHERE folder_id IS NULL", defaultID)
	return err
}

func folderDefaultColumnExists(db *sql.DB) (bool, error) {
	rows, err := db.Query("PRAGMA table_info(session_folders)")
	if err != nil {
		return false, err
	}
	hasColumn := false
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return false, err
		}
		if name == "is_default" {
			hasColumn = true
		}
	}
	if err := rows.Close(); err != nil {
		return false, err
	}
	return hasColumn, nil
}

func resolveDefaultFolderID(db *sql.DB) (int64, error) {
	var defaultID sql.NullInt64
	if err := db.QueryRow("SELECT id FROM session_folders WHERE is_default = 1 ORDER BY id LIMIT 1").Scan(&defaultID); err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	if !defaultID.Valid {
		var firstID sql.NullInt64
		if err := db.QueryRow("SELECT id FROM session_folders ORDER BY id LIMIT 1").Scan(&firstID); err != nil && err != sql.ErrNoRows {
			return 0, err
		}
		if firstID.Valid {
			defaultID = firstID
		} else {
			result, err := db.Exec("INSERT INTO session_folders (name, is_default) VALUES ('默认分组', 1)")
			if err != nil {
				return 0, err
			}
			id, err := result.LastInsertId()
			if err != nil {
				return 0, err
			}
			defaultID = sql.NullInt64{Int64: id, Valid: true}
		}
	}
	return defaultID.Int64, nil
}
