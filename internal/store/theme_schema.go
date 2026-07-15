package store

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
