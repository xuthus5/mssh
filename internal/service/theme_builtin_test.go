package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestThemeServiceUpgradesLegacyBuiltinsWithoutDuplicatingProfiles(t *testing.T) {
	db := testutil.NewTestDB(t)
	legacyDefinition, err := store.CreateThemeDefinition(db, model.ThemeDefinition{
		Name: "GitHub Dark", Mode: model.ThemeModeDark, SourceType: model.ThemeSourceBuiltin,
		SourceName: "MSSH", SourceLicense: "MIT", SourceVersion: "1",
		SourceFingerprint: "builtin:github-dark:v1", ColorPayload: `{"background":"#000000","foreground":"#ffffff","cursor":"#ffffff","selection":"#333333","ansi":["#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000"]}`, IsBuiltin: true,
	})
	require.NoError(t, err)
	legacyProfile, err := store.CreateThemeProfile(db, model.ThemeProfile{Name: "Renamed Dark", ThemeID: legacyDefinition.ID, FontFamily: "User Font", FontSize: 20, CursorStyle: model.CursorStyleUnderline, ColorOverrides: `{"background":"#123456"}`})
	require.NoError(t, err)
	themeService := NewThemeService(db, testutil.NewTestLogger())

	require.NoError(t, themeService.InitializeDefaults())
	definitions, err := themeService.ListDefinitions("")
	require.NoError(t, err)
	require.Len(t, definitions, 24)
	upgradedProfile, err := themeService.GetProfile(legacyProfile.ID)
	require.NoError(t, err)
	assert.Equal(t, legacyProfile.ID, upgradedProfile.ID)
	assert.Equal(t, "Renamed Dark", upgradedProfile.Name)
	assert.Equal(t, "User Font", upgradedProfile.FontFamily)
	assert.Equal(t, 20, upgradedProfile.FontSize)
	assert.Equal(t, expectedBuiltinThemeVersion, upgradedProfile.Definition.SourceVersion)
}

func TestThemeServiceDoesNotReuseImportedDefinitionWithBuiltinColors(t *testing.T) {
	db := testutil.NewTestDB(t)
	githubDark := mustBuiltinDefinitionNamed(t, "GitHub Dark")
	legacy, err := store.CreateThemeDefinition(db, model.ThemeDefinition{
		Name: "GitHub Dark", Mode: model.ThemeModeDark, SourceType: model.ThemeSourceBuiltin,
		SourceName: "MSSH", SourceFingerprint: "builtin:github-dark:v1", ColorPayload: githubDark.ColorPayload, IsBuiltin: true,
	})
	require.NoError(t, err)
	legacyProfile, err := store.CreateThemeProfile(db, model.ThemeProfile{Name: "Legacy Dark", ThemeID: legacy.ID, FontFamily: "User Font", FontSize: 18, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`})
	require.NoError(t, err)
	importedDefinition, err := store.CreateThemeDefinition(db, model.ThemeDefinition{
		Name: "Imported GitHub Colors", Mode: model.ThemeModeDark, SourceType: model.ThemeSourceITerm2,
		SourceFingerprint: strings.TrimPrefix(githubDark.SourceFingerprint, "builtin:"), ColorPayload: githubDark.ColorPayload,
	})
	require.NoError(t, err)
	importedProfile, err := store.CreateThemeProfile(db, model.ThemeProfile{Name: "Imported", ThemeID: importedDefinition.ID, FontFamily: "Imported Font", FontSize: 15, CursorStyle: model.CursorStyleUnderline, ColorOverrides: `{}`})
	require.NoError(t, err)
	themeService := NewThemeService(db, testutil.NewTestLogger())

	require.NoError(t, themeService.InitializeDefaults())
	definitions, err := themeService.ListDefinitions("")
	require.NoError(t, err)
	builtinCount := 0
	for _, definition := range definitions {
		if definition.IsBuiltin {
			builtinCount++
		}
	}
	assert.Equal(t, 24, builtinCount)
	upgraded, err := themeService.GetProfile(legacyProfile.ID)
	require.NoError(t, err)
	assert.True(t, upgraded.Definition.IsBuiltin)
	assert.Equal(t, expectedBuiltinThemeVersion, upgraded.Definition.SourceVersion)
	storedImported, err := themeService.GetProfile(importedProfile.ID)
	require.NoError(t, err)
	assert.Equal(t, model.ThemeSourceITerm2, storedImported.Definition.SourceType)
	assignments, err := themeService.GetAssignments()
	require.NoError(t, err)
	assert.Equal(t, legacyProfile.ID, assignments.DarkProfileID)
}

func TestThemeServiceRestoresMissingBuiltinsWithoutOverwritingProfiles(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())

	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	dracula := mustThemeProfileNamed(t, profiles, "Dracula")
	dark.FontFamily = "User Font"
	dark.FontSize = 20
	dark.ColorOverrides = `{"background":"#123456"}`
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(dark)))
	_, err := db.Exec("DELETE FROM terminal_theme_profiles WHERE theme_id = ?", dracula.ThemeID)
	require.NoError(t, err)
	_, err = db.Exec("DELETE FROM themes WHERE id = ?", dracula.ThemeID)
	require.NoError(t, err)

	require.NoError(t, themeService.InitializeDefaults())
	profiles = mustThemeProfiles(t, themeService)
	require.Len(t, profiles, 24)
	restoredDark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	assert.Equal(t, "User Font", restoredDark.FontFamily)
	assert.Equal(t, 20, restoredDark.FontSize)
	assert.JSONEq(t, `{"background":"#123456"}`, restoredDark.ColorOverrides)
	assert.NotZero(t, mustThemeProfileNamed(t, profiles, "Dracula").ID)
}

func TestThemeServiceResetsAssignedBuiltinStylesOnly(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")

	directory := t.TempDir()
	path := filepath.Join(directory, "Imported.itermcolors")
	require.NoError(t, os.WriteFile(path, []byte(serviceITermFixture()), 0o600))
	summary, err := themeService.ImportFiles([]string{path})
	require.NoError(t, err)
	require.Equal(t, model.ThemeImportImported, summary.Results[0].Status)
	imported, err := themeService.GetProfile(summary.Results[0].ProfileID)
	require.NoError(t, err)

	dark = customizeThemeProfile(dark, "Dark User Font", 22, `{"background":"#111111"}`)
	*imported = customizeThemeProfile(*imported, "Imported User Font", 19, `{"background":"#eeeeee"}`)
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(dark)))
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(*imported)))
	require.NoError(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: imported.ID}))

	result, err := themeService.ResetBuiltinStyles()
	require.NoError(t, err)
	assert.True(t, result.DarkReset)
	assert.False(t, result.LightReset)

	resetDark, err := themeService.GetProfile(dark.ID)
	require.NoError(t, err)
	assert.Equal(t, dark.Name, resetDark.Name)
	assert.Equal(t, dark.ThemeID, resetDark.ThemeID)
	assert.Equal(t, defaultTerminalFont, resetDark.FontFamily)
	assert.Equal(t, 14, resetDark.FontSize)
	assert.Equal(t, model.CursorStyleBar, resetDark.CursorStyle)
	assert.JSONEq(t, `{}`, resetDark.ColorOverrides)

	storedImported, err := themeService.GetProfile(imported.ID)
	require.NoError(t, err)
	assert.Equal(t, imported.Name, storedImported.Name)
	assert.Equal(t, imported.ThemeID, storedImported.ThemeID)
	assert.Equal(t, "Imported User Font", storedImported.FontFamily)
	assert.Equal(t, 19, storedImported.FontSize)
	assert.Equal(t, model.CursorStyleUnderline, storedImported.CursorStyle)
	assert.JSONEq(t, `{"background":"#eeeeee"}`, storedImported.ColorOverrides)
	assignments, err := themeService.GetAssignments()
	require.NoError(t, err)
	assert.Equal(t, dark.ID, assignments.DarkProfileID)
	assert.Equal(t, imported.ID, assignments.LightProfileID)
}

func TestThemeServiceResetsBothDefaultBuiltinStyles(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())

	result, err := themeService.ResetBuiltinStyles()
	require.NoError(t, err)
	assert.True(t, result.DarkReset)
	assert.True(t, result.LightReset)
}

func TestThemeServiceResetsAssignedLightBuiltinStyle(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	light := mustThemeProfileNamed(t, mustThemeProfiles(t, themeService), "GitHub Light")
	directory := t.TempDir()
	path := filepath.Join(directory, "Imported.itermcolors")
	require.NoError(t, os.WriteFile(path, []byte(serviceITermFixture()), 0o600))
	summary, err := themeService.ImportFiles([]string{path})
	require.NoError(t, err)
	importedID := summary.Results[0].ProfileID
	require.NoError(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: importedID, LightProfileID: light.ID}))

	result, err := themeService.ResetBuiltinStyles()
	require.NoError(t, err)
	assert.False(t, result.DarkReset)
	assert.True(t, result.LightReset)
}

func TestThemeServiceResetBuiltinStylesRollsBack(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := customizeThemeProfile(mustThemeProfileNamed(t, profiles, "GitHub Dark"), "Dark User Font", 21, `{"background":"#111111"}`)
	light := customizeThemeProfile(mustThemeProfileNamed(t, profiles, "GitHub Light"), "Light User Font", 18, `{"background":"#eeeeee"}`)
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(dark)))
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(light)))
	require.NoError(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: light.ID}))
	_, err := db.Exec(`CREATE TRIGGER fail_light_theme_reset BEFORE UPDATE ON terminal_theme_profiles WHEN OLD.id = ` + themeProfileID(light.ID) + ` BEGIN SELECT RAISE(FAIL, 'reset failed'); END`)
	require.NoError(t, err)

	_, err = themeService.ResetBuiltinStyles()
	assert.ErrorContains(t, err, "reset built-in theme styles")
	storedDark, getErr := themeService.GetProfile(dark.ID)
	require.NoError(t, getErr)
	assert.Equal(t, "Dark User Font", storedDark.FontFamily)
	assert.Equal(t, 21, storedDark.FontSize)
	assert.JSONEq(t, `{"background":"#111111"}`, storedDark.ColorOverrides)
}

func TestThemeServiceInitializationRollsBack(t *testing.T) {
	db := testutil.NewTestDB(t)
	_, err := db.Exec(`CREATE TRIGGER fail_dracula_theme BEFORE INSERT ON themes WHEN NEW.name = 'Dracula' BEGIN SELECT RAISE(FAIL, 'catalog failed'); END`)
	require.NoError(t, err)
	themeService := NewThemeService(db, testutil.NewTestLogger())

	err = themeService.InitializeDefaults()
	assert.ErrorContains(t, err, "initialize terminal themes")
	var count int
	require.NoError(t, db.QueryRow("SELECT COUNT(*) FROM themes").Scan(&count))
	assert.Zero(t, count)
}

func TestThemeServiceInitializationRollsBackProfileFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	_, err := db.Exec(`CREATE TRIGGER fail_dracula_profile BEFORE INSERT ON terminal_theme_profiles WHEN NEW.name = 'Dracula' BEGIN SELECT RAISE(FAIL, 'profile failed'); END`)
	require.NoError(t, err)
	themeService := NewThemeService(db, testutil.NewTestLogger())

	err = themeService.InitializeDefaults()
	assert.ErrorContains(t, err, "initialize terminal themes")
	var definitions, profiles int
	require.NoError(t, db.QueryRow("SELECT COUNT(*) FROM themes").Scan(&definitions))
	require.NoError(t, db.QueryRow("SELECT COUNT(*) FROM terminal_theme_profiles").Scan(&profiles))
	assert.Zero(t, definitions)
	assert.Zero(t, profiles)
}

func mustThemeProfiles(t *testing.T, themeService *ThemeService) []model.ThemeProfile {
	t.Helper()
	profiles, err := themeService.ListProfiles("")
	require.NoError(t, err)
	return profiles
}

func mustThemeProfileNamed(t *testing.T, profiles []model.ThemeProfile, name string) model.ThemeProfile {
	t.Helper()
	for _, profile := range profiles {
		if profile.Name == name {
			return profile
		}
	}
	t.Fatalf("theme profile %q not found", name)
	return model.ThemeProfile{}
}

func customizeThemeProfile(profile model.ThemeProfile, font string, size int, overrides string) model.ThemeProfile {
	profile.FontFamily = font
	profile.FontSize = size
	profile.CursorStyle = model.CursorStyleUnderline
	profile.ColorOverrides = overrides
	return profile
}

func themeProfileID(id int64) string {
	return fmt.Sprintf("%d", id)
}

func mustBuiltinDefinitionNamed(t *testing.T, name string) model.ThemeDefinition {
	t.Helper()
	for _, definition := range builtinThemeDefinitions() {
		if definition.Name == name {
			return definition
		}
	}
	t.Fatalf("built-in theme definition %q not found", name)
	return model.ThemeDefinition{}
}
