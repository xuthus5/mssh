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

	custom := createThemeDefinitionFixture(t, db, "Custom", model.ThemeModeDark, "custom", false)
	profile, err := CreateThemeProfile(db, model.ThemeProfile{Name: "Custom", ThemeID: custom.ID, FontFamily: "monospace", FontSize: 14, CursorStyle: model.CursorStyleBlock, ColorOverrides: `{}`})
	require.NoError(t, err)
	assert.Error(t, DeleteThemeDefinition(db, custom.ID))
	require.NoError(t, DeleteThemeProfile(db, profile.ID))
}

func TestThemeAssignmentsStore(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, SaveThemeAssignments(db, model.ThemeAssignments{DarkProfileID: 4, LightProfileID: 7}))
	assignments, err := GetThemeAssignments(db)
	require.NoError(t, err)
	assert.Equal(t, model.ThemeAssignments{DarkProfileID: 4, LightProfileID: 7}, assignments)
}

func createThemeDefinitionFixture(t *testing.T, db *sql.DB, name string, mode model.ThemeMode, fingerprint string, builtin bool) *model.ThemeDefinition {
	t.Helper()
	definition, err := CreateThemeDefinition(db, model.ThemeDefinition{Name: name, Mode: mode, SourceType: model.ThemeSourceCustom, SourceFingerprint: fingerprint, ColorPayload: `{"background":"#000000"}`, IsBuiltin: builtin})
	require.NoError(t, err)
	return definition
}
