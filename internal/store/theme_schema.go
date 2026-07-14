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
	follow_global_style INTEGER NOT NULL DEFAULT 1,
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
	definitionColumns, err := tableColumns(db, "themes")
	if err != nil {
		return false, fmt.Errorf("inspect themes schema: %w", err)
	}
	definitionsCurrent := definitionColumns["mode"] && definitionColumns["source_fingerprint"] && definitionColumns["color_payload"]
	if !definitionsCurrent {
		return false, nil
	}
	profileColumns, err := tableColumns(db, "terminal_theme_profiles")
	if err != nil {
		return false, fmt.Errorf("inspect terminal theme profiles: %w", err)
	}
	return profileColumns["theme_id"] && profileColumns["follow_global_style"] && profileColumns["font_family"] && profileColumns["font_size"] && profileColumns["cursor_style"] && profileColumns["color_overrides"], nil
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
