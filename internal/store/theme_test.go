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
	dark := createThemeDefinitionFixture(t, db, "Dark", model.ThemeModeDark, "dark-fingerprint", false)
	_ = createThemeDefinitionFixture(t, db, "Light", model.ThemeModeLight, "light-fingerprint", false)

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

	profile, err := CreateThemeProfile(db, model.ThemeProfile{Name: "Dark Profile", ThemeID: dark.ID, FontFamily: "monospace", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`})
	require.NoError(t, err)
	profile.FontSize = 16
	require.NoError(t, UpdateThemeProfile(db, *profile))
	loaded, err := GetThemeProfile(db, profile.ID)
	require.NoError(t, err)
	assert.Equal(t, 16, loaded.FontSize)
	assert.Equal(t, dark.Name, loaded.Definition.Name)

	require.NoError(t, DeleteThemeProfile(db, profile.ID))
	require.NoError(t, DeleteThemeDefinition(db, dark.ID))
}

func TestThemeCatalogStoreConstraints(t *testing.T) {
	db := setupTestDB(t)
	builtin := createThemeDefinitionFixture(t, db, "Builtin", model.ThemeModeDark, "builtin", true)
	_, err := CreateThemeDefinition(db, model.ThemeDefinition{Name: "Duplicate", Mode: model.ThemeModeDark, SourceType: model.ThemeSourceCustom, SourceFingerprint: "builtin", ColorPayload: `{}`})
	assert.Error(t, err)
	assert.Error(t, DeleteThemeDefinition(db, builtin.ID))
	assert.Error(t, UpdateThemeDefinition(db, model.ThemeDefinition{ID: -1, Name: "Missing"}))

	custom := createThemeDefinitionFixture(t, db, "Custom", model.ThemeModeDark, "custom", false)
	profile, err := CreateThemeProfile(db, model.ThemeProfile{Name: "Custom", ThemeID: custom.ID, FontFamily: "monospace", FontSize: 14, CursorStyle: model.CursorStyleBlock, ColorOverrides: `{}`})
	require.NoError(t, err)
	assert.Error(t, DeleteThemeDefinition(db, custom.ID))
	require.NoError(t, DeleteThemeProfile(db, profile.ID))
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
	definition := createThemeDefinitionFixture(t, db, "Shared", model.ThemeModeUniversal, "shared-delete", false)
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

func createThemeDefinitionFixture(t *testing.T, db *sql.DB, name string, mode model.ThemeMode, fingerprint string, builtin bool) *model.ThemeDefinition {
	t.Helper()
	definition, err := CreateThemeDefinition(db, model.ThemeDefinition{Name: name, Mode: mode, SourceType: model.ThemeSourceCustom, SourceFingerprint: fingerprint, ColorPayload: `{"background":"#000000"}`, IsBuiltin: builtin})
	require.NoError(t, err)
	return definition
}
