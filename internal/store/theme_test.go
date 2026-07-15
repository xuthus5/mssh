package store

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestThemeCatalogStoreCRUDAndFilters(t *testing.T) {
	db := setupTestDB(t)
	dark := createThemeDefinitionFixture(t, db, themeDefinitionFixture{name: "Dark", mode: model.ThemeModeDark, fingerprint: "dark-fingerprint"})
	_ = createThemeDefinitionFixture(t, db, themeDefinitionFixture{name: "Light", mode: model.ThemeModeLight, fingerprint: "light-fingerprint"})

	definitions, err := ListThemeDefinitions(db, model.ThemeModeDark)
	require.NoError(t, err)
	require.Len(t, definitions, 1)
	assert.Equal(t, dark.ID, definitions[0].ID)
	dark.Name = "Dark Updated"
	dark.SourceVersion = "v2"
	dark.ColorPayload = `{"background":"#111111"}`
	require.NoError(t, UpdateThemeDefinition(db, *dark))
	updatedDefinition, err := GetThemeDefinition(db, dark.ID)
	require.NoError(t, err)
	assert.Equal(t, "Dark Updated", updatedDefinition.Name)
	assert.Equal(t, "v2", updatedDefinition.SourceVersion)
	assert.JSONEq(t, `{"background":"#111111"}`, updatedDefinition.ColorPayload)

	profile, err := CreateThemeProfile(db, model.ThemeProfile{Name: "Dark Profile", ThemeID: dark.ID, FollowGlobalStyle: true, FontFamily: "monospace", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`})
	require.NoError(t, err)
	profile.FontSize = 16
	profile.FollowGlobalStyle = false
	require.NoError(t, UpdateThemeProfile(db, *profile))
	loaded, err := GetThemeProfile(db, profile.ID)
	require.NoError(t, err)
	assert.Equal(t, 16, loaded.FontSize)
	assert.False(t, loaded.FollowGlobalStyle)
	assert.Equal(t, dark.Name, loaded.Definition.Name)
	profiles, err := ListThemeProfiles(db, model.ThemeModeDark)
	require.NoError(t, err)
	require.Len(t, profiles, 1)
	assert.Equal(t, profile.ID, profiles[0].ID)
	profiles, err = ListThemeProfiles(db, "")
	require.NoError(t, err)
	assert.Len(t, profiles, 1)

	require.NoError(t, SaveThemeAssignments(db, model.ThemeAssignments{}))
	require.NoError(t, DeleteThemeProfile(db, profile.ID))
	require.NoError(t, DeleteThemeDefinition(db, dark.ID))
}

func TestThemeCatalogStoreConstraints(t *testing.T) {
	db := setupTestDB(t)
	builtin := createThemeDefinitionFixture(t, db, themeDefinitionFixture{name: "Builtin", mode: model.ThemeModeDark, fingerprint: "builtin", builtin: true})
	_, err := CreateThemeDefinition(db, model.ThemeDefinition{Name: "Duplicate", Mode: model.ThemeModeDark, SourceType: model.ThemeSourceCustom, SourceFingerprint: "builtin", ColorPayload: `{}`})
	assert.Error(t, err)
	assert.Error(t, DeleteThemeDefinition(db, builtin.ID))
	assert.Error(t, UpdateThemeDefinition(db, model.ThemeDefinition{ID: -1, Name: "Missing"}))

	custom := createThemeDefinitionFixture(t, db, themeDefinitionFixture{name: "Custom", mode: model.ThemeModeDark, fingerprint: "custom"})
	profile, err := CreateThemeProfile(db, model.ThemeProfile{Name: "Custom", ThemeID: custom.ID, FontFamily: "monospace", FontSize: 14, CursorStyle: model.CursorStyleBlock, ColorOverrides: `{}`})
	require.NoError(t, err)
	assert.Error(t, DeleteThemeDefinition(db, custom.ID))
	require.NoError(t, SaveThemeAssignments(db, model.ThemeAssignments{}))
	require.NoError(t, DeleteThemeProfile(db, profile.ID))
	_, err = CreateThemeProfile(db, model.ThemeProfile{Name: "Missing", ThemeID: -1})
	assert.ErrorContains(t, err, "create theme profile")
	_, err = GetThemeProfile(db, -1)
	assert.ErrorContains(t, err, "get theme profile")
	assert.ErrorContains(t, UpdateThemeProfile(db, model.ThemeProfile{ID: -1}), "theme profile not found")
	assert.ErrorContains(t, DeleteThemeProfile(db, -1), "theme profile not found")
}

func TestListThemeProfilesReportsQueryErrors(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())
	_, err := ListThemeProfiles(db, model.ThemeModeDark)
	assert.ErrorContains(t, err, "list theme profiles")
}

func TestListThemeProfilesReportsInvalidStoredValues(t *testing.T) {
	db := setupTestDB(t)
	definition := createThemeDefinitionFixture(t, db, themeDefinitionFixture{name: "Invalid Profile", mode: model.ThemeModeDark, fingerprint: "invalid-profile"})
	_, err := db.Exec(`INSERT INTO terminal_theme_profiles (name, theme_id, follow_global_style, font_family, font_size, cursor_style, color_overrides) VALUES ('Invalid', ?, 1, 'mono', 'large', 'bar', '{}')`, definition.ID)
	require.NoError(t, err)
	_, err = ListThemeProfiles(db, model.ThemeModeDark)
	assert.ErrorContains(t, err, "font_size")
}

func TestLoadThemeAssignmentsReportsAbsentState(t *testing.T) {
	db := setupTestDB(t)
	assignments, exists, err := LoadThemeAssignments(db)
	require.NoError(t, err)
	assert.False(t, exists)
	assert.Equal(t, model.ThemeAssignments{}, assignments)
	_, err = GetThemeAssignments(db)
	assert.ErrorContains(t, err, "not initialized")
}

func TestLoadThemeAssignmentsRejectsIncompleteState(t *testing.T) {
	db := setupTestDB(t)
	expected := model.ThemeAssignments{DarkProfileID: 4, LightProfileID: 7, FollowInterfaceMode: false, FixedProfileID: 9}
	require.NoError(t, SaveThemeAssignments(db, expected))
	_, err := db.Exec(`DELETE FROM settings WHERE key = ?`, fixedThemeProfileKey)
	require.NoError(t, err)
	_, _, err = LoadThemeAssignments(db)
	assert.ErrorContains(t, err, "incomplete")
}

func TestLoadThemeAssignmentsAcceptsCompleteStates(t *testing.T) {
	for _, expected := range []model.ThemeAssignments{
		{},
		{DarkProfileID: 4, LightProfileID: 7, FollowInterfaceMode: false, FixedProfileID: 9},
	} {
		db := setupTestDB(t)
		require.NoError(t, SaveThemeAssignments(db, expected))
		assignments, exists, err := LoadThemeAssignments(db)
		require.NoError(t, err)
		assert.True(t, exists)
		assert.Equal(t, expected, assignments)
	}
}

func TestLoadThemeAssignmentsRejectsCorruptState(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, SaveThemeAssignments(db, model.ThemeAssignments{}))
	_, err := db.Exec(`UPDATE settings SET value = 'invalid' WHERE key = ?`, darkThemeProfileKey)
	require.NoError(t, err)
	_, _, err = LoadThemeAssignments(db)
	assert.ErrorContains(t, err, "parse theme assignment")
}

func TestLoadThemeAssignmentsRejectsInvalidSettingContract(t *testing.T) {
	tests := []struct {
		name, query string
		args        []any
	}{
		{name: "namespace mismatch", query: `UPDATE settings SET namespace = 'appearance' WHERE key = ?`, args: []any{darkThemeProfileKey}},
		{name: "namespace must be terminal", query: `UPDATE settings SET namespace = 'terminal.theme' WHERE key = ?`, args: []any{darkThemeProfileKey}},
		{name: "legacy namespace", query: `UPDATE settings SET namespace = 'legacy' WHERE key = ?`, args: []any{darkThemeProfileKey}},
		{name: "unsupported version", query: `UPDATE settings SET version = 2 WHERE key = ?`, args: []any{darkThemeProfileKey}},
		{name: "invalid timestamp", query: `UPDATE settings SET updated_at = 'invalid' WHERE key = ?`, args: []any{darkThemeProfileKey}},
		{name: "invalid json", query: `UPDATE settings SET value = '{' WHERE key = ?`, args: []any{darkThemeProfileKey}},
		{name: "mismatched json type", query: `UPDATE settings SET value = 'true' WHERE key = ?`, args: []any{darkThemeProfileKey}},
		{name: "wrong number assignment type", query: `UPDATE settings SET value = '"1"', value_type = 'string' WHERE key = ?`, args: []any{darkThemeProfileKey}},
		{name: "wrong boolean assignment type", query: `UPDATE settings SET value = '1', value_type = 'number' WHERE key = ?`, args: []any{followThemeModeKey}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := setupTestDB(t)
			require.NoError(t, SaveThemeAssignments(db, model.ThemeAssignments{}))
			_, err := db.Exec(test.query, test.args...)
			require.NoError(t, err)
			_, _, err = LoadThemeAssignments(db)
			require.Error(t, err)
		})
	}
}

func TestDeleteThemeProfileProtectsActiveAssignments(t *testing.T) {
	db := setupTestDB(t)
	definition := createThemeDefinitionFixture(t, db, themeDefinitionFixture{name: "Shared", mode: model.ThemeModeUniversal, fingerprint: "shared-delete"})
	dark, err := CreateThemeProfile(db, model.ThemeProfile{Name: "Dark", ThemeID: definition.ID, FontFamily: "monospace", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`})
	require.NoError(t, err)
	light, err := CreateThemeProfile(db, model.ThemeProfile{Name: "Light", ThemeID: definition.ID, FontFamily: "monospace", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`})
	require.NoError(t, err)
	fixed, err := CreateThemeProfile(db, model.ThemeProfile{Name: "Fixed", ThemeID: definition.ID, FontFamily: "monospace", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`})
	require.NoError(t, err)

	assignments := model.ThemeAssignments{DarkProfileID: dark.ID, LightProfileID: light.ID, FollowInterfaceMode: false, FixedProfileID: fixed.ID}
	require.NoError(t, SaveThemeAssignments(db, assignments))
	assert.Error(t, DeleteThemeProfile(db, dark.ID))
	assert.Error(t, DeleteThemeProfile(db, light.ID))
	assert.Error(t, DeleteThemeProfile(db, fixed.ID))

	assignments.FollowInterfaceMode = true
	require.NoError(t, SaveThemeAssignments(db, assignments))
	require.NoError(t, DeleteThemeProfile(db, fixed.ID))
	loaded, err := GetThemeAssignments(db)
	require.NoError(t, err)
	assert.Zero(t, loaded.FixedProfileID)
}

func TestThemeAssignmentsStoreReportsInvalidValuesAndDatabaseErrors(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, SaveThemeAssignments(db, model.ThemeAssignments{}))
	require.NoError(t, db.Close())
	_, _, err := LoadThemeAssignments(db)
	assert.ErrorContains(t, err, "read theme assignment")
}

type themeDefinitionFixture struct {
	name        string
	mode        model.ThemeMode
	fingerprint string
	builtin     bool
}

func createThemeDefinitionFixture(t *testing.T, db *sql.DB, fixture themeDefinitionFixture) *model.ThemeDefinition {
	t.Helper()
	definition, err := CreateThemeDefinition(db, model.ThemeDefinition{Name: fixture.name, Mode: fixture.mode, SourceType: model.ThemeSourceCustom, SourceFingerprint: fixture.fingerprint, ColorPayload: `{"background":"#000000"}`, IsBuiltin: fixture.builtin})
	require.NoError(t, err)
	return definition
}
