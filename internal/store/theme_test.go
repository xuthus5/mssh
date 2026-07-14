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

func TestThemeAssignmentsStore(t *testing.T) {
	db := setupTestDB(t)
	expected := model.ThemeAssignments{DarkProfileID: 4, LightProfileID: 7, FollowInterfaceMode: false, FixedProfileID: 9}
	require.NoError(t, SaveThemeAssignments(db, expected))
	assignments, err := GetThemeAssignments(db)
	require.NoError(t, err)
	assert.Equal(t, expected, assignments)

	_, err = db.Exec(`DELETE FROM settings WHERE key IN ('terminal.theme.follow_interface_mode', 'terminal.theme.fixed_profile_id')`)
	require.NoError(t, err)
	assignments, err = GetThemeAssignments(db)
	require.NoError(t, err)
	assert.True(t, assignments.FollowInterfaceMode)
	assert.Zero(t, assignments.FixedProfileID)
	assert.Equal(t, expected.DarkProfileID, assignments.DarkProfileID)
	assert.Equal(t, expected.LightProfileID, assignments.LightProfileID)
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
	_, err := db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version) VALUES ('terminal.theme.dark_profile_id', 'terminal', 'invalid', 'number', 1)`)
	require.NoError(t, err)
	_, err = GetThemeAssignments(db)
	assert.ErrorContains(t, err, "parse theme assignment")

	_, err = db.Exec(`DELETE FROM settings`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version) VALUES ('terminal.theme.follow_interface_mode', 'terminal', 'not-a-bool', 'boolean', 1)`)
	require.NoError(t, err)
	_, err = GetThemeAssignments(db)
	assert.ErrorContains(t, err, "terminal.theme.follow_interface_mode")

	_, err = db.Exec(`DELETE FROM settings`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version) VALUES
		('terminal.theme.dark_profile_id', 'terminal', '1', 'number', 1),
		('terminal.theme.light_profile_id', 'terminal', '2', 'number', 1),
		('terminal.theme.follow_interface_mode', 'terminal', 'true', 'boolean', 1),
		('terminal.theme.fixed_profile_id', 'terminal', 'invalid', 'number', 1)`)
	require.NoError(t, err)
	_, err = GetThemeAssignments(db)
	assert.ErrorContains(t, err, "terminal.theme.fixed_profile_id")

	require.NoError(t, db.Close())
	_, err = GetThemeAssignments(db)
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
