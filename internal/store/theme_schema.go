package store

import (
	"database/sql"
	"fmt"
)

const themeDefinitionsSchema = `CREATE TABLE IF NOT EXISTS themes (
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
)`

const themeProfilesSchema = `CREATE TABLE IF NOT EXISTS terminal_theme_profiles (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE RESTRICT,
	font_family TEXT NOT NULL,
	font_size INTEGER NOT NULL,
	cursor_style TEXT NOT NULL CHECK(cursor_style IN ('block', 'underline', 'bar')),
	color_overrides TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

func ensureThemeCatalogSchema(db *sql.DB) error {
	current, err := themeCatalogSchemaCurrent(db)
	if err != nil {
		return err
	}
	if !current {
		if err = replaceLegacyThemeSchema(db); err != nil {
			return err
		}
	}
	if _, err = db.Exec(themeDefinitionsSchema); err != nil {
		return fmt.Errorf("create themes: %w", err)
	}
	if _, err = db.Exec(themeProfilesSchema); err != nil {
		return fmt.Errorf("create terminal theme profiles: %w", err)
	}
	return nil
}

func themeCatalogSchemaCurrent(db *sql.DB) (bool, error) {
	rows, err := db.Query("PRAGMA table_info(themes)")
	if err != nil {
		return false, fmt.Errorf("inspect themes schema: %w", err)
	}
	columns := make(map[string]bool)
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err = rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return false, fmt.Errorf("scan themes schema: %w", err)
		}
		columns[name] = true
	}
	if err = rows.Close(); err != nil {
		return false, fmt.Errorf("close themes schema rows: %w", err)
	}
	return columns["mode"] && columns["source_fingerprint"] && columns["color_payload"], nil
}

func replaceLegacyThemeSchema(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin theme schema replacement: %w", err)
	}
	if _, err = tx.Exec("DROP TABLE IF EXISTS terminal_theme_profiles"); err == nil {
		_, err = tx.Exec("DROP TABLE IF EXISTS themes")
	}
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("replace legacy theme schema: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit theme schema replacement: %w", err)
	}
	return nil
}
