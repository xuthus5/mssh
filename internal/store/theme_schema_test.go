package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestThemeCatalogSchema(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, Migrate(db))
	assertTableColumns(t, tableColumnExpectation{db: db, table: "themes", expected: []string{"id", "name", "mode", "source_type", "source_name", "source_url", "source_author", "source_license", "source_version", "source_fingerprint", "color_payload", "raw_payload", "is_builtin", "created_at", "updated_at"}})
	assertTableColumns(t, tableColumnExpectation{db: db, table: "terminal_theme_profiles", expected: []string{"id", "name", "theme_id", "follow_global_style", "font_family", "font_size", "cursor_style", "color_overrides", "created_at", "updated_at"}})
	_, err = db.Exec("INSERT INTO themes (name, mode, source_type, source_fingerprint, color_payload) VALUES ('A', 'dark', 'custom', 'same', '{}'), ('B', 'light', 'custom', 'same', '{}')")
	assert.Error(t, err)
}

func TestMigrateReplacesStaleThemeSchema(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.Exec("CREATE TABLE themes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_builtin INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))")
	require.NoError(t, err)
	require.NoError(t, Migrate(db))
	assertTableColumns(t, tableColumnExpectation{db: db, table: "themes", expected: []string{"mode", "source_fingerprint", "color_payload", "updated_at"}})
}

func TestMigrateReplacesStaleThemeProfileSchema(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.Exec(themeDefinitionsSchema)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TABLE terminal_theme_profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
		theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE RESTRICT,
		font_family TEXT NOT NULL, font_size INTEGER NOT NULL, cursor_style TEXT NOT NULL,
		color_overrides TEXT NOT NULL DEFAULT '{}'
	)`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO themes (name, mode, source_type, source_fingerprint, color_payload) VALUES ('Old', 'dark', 'custom', 'old', '{}')`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO terminal_theme_profiles (name, theme_id, font_family, font_size, cursor_style) VALUES ('Old', 1, 'mono', 14, 'bar')`)
	require.NoError(t, err)
	require.NoError(t, Migrate(db))
	assertTableColumns(t, tableColumnExpectation{db: db, table: "terminal_theme_profiles", expected: []string{"follow_global_style"}})
	var count int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM terminal_theme_profiles").Scan(&count))
	assert.Zero(t, count)
}

func TestMigrateReplacesThemeSchemaWithMatchingColumnsButWrongConstraints(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.Exec(`CREATE TABLE themes (
		id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, mode TEXT NOT NULL,
		source_type TEXT NOT NULL, source_name TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
		source_author TEXT NOT NULL DEFAULT '', source_license TEXT NOT NULL DEFAULT '', source_version TEXT NOT NULL DEFAULT '',
		source_fingerprint TEXT NOT NULL UNIQUE, color_payload TEXT NOT NULL, raw_payload TEXT NOT NULL DEFAULT '',
		is_builtin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TABLE terminal_theme_profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, theme_id INTEGER NOT NULL REFERENCES themes(id),
		follow_global_style INTEGER NOT NULL DEFAULT 0, font_family TEXT NOT NULL, font_size INTEGER NOT NULL,
		cursor_style TEXT NOT NULL, color_overrides TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO themes (name, mode, source_type, source_fingerprint, color_payload) VALUES ('Old', 'sepia', 'legacy', 'old', '{}')`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO terminal_theme_profiles (name, theme_id, font_family, font_size, cursor_style) VALUES ('Old', 1, 'mono', 14, 'beam')`)
	require.NoError(t, err)
	require.NoError(t, Migrate(db))
	definitionsCurrent, err := tableSchemaCurrent(db, "themes", themeDefinitionsSchema)
	require.NoError(t, err)
	profilesCurrent, err := tableSchemaCurrent(db, "terminal_theme_profiles", themeProfilesSchema)
	require.NoError(t, err)
	assert.True(t, definitionsCurrent)
	assert.True(t, profilesCurrent)
	var count int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM themes").Scan(&count))
	assert.Zero(t, count)
}

func TestThemeSchemaHelpersClosedDB(t *testing.T) {
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, db.Close())
	_, err = themeCatalogSchemaCurrent(db)
	assert.ErrorContains(t, err, "inspect themes schema")
	assert.ErrorContains(t, replaceThemeCatalogSchema(db), "begin theme schema replacement")
	assert.Error(t, ensureThemeCatalogSchema(db))
}
