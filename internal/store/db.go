package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func OpenDB(dataDir string) (*sql.DB, error) {
	_ = os.MkdirAll(dataDir, 0700)
	dbPath := filepath.Join(dataDir, "mssh.db")
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	_ = os.Chmod(dbPath, 0600)
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
		`CREATE TABLE IF NOT EXISTS settings (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS session_logs (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id INTEGER REFERENCES sessions(id),
			started_at TEXT NOT NULL,
			ended_at   TEXT,
			data_path  TEXT NOT NULL
		)`,
	}
	for _, m := range migrations {
		_, err := db.Exec(m)
		if err != nil {
			return fmt.Errorf("migration: %w", err)
		}
	}
	return nil
}
