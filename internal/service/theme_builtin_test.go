package service

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

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

	dark = customizeThemeProfile(dark, themeProfileStyle{font: "Dark User Font", size: 22, overrides: `{"background":"#111111"}`})
	*imported = customizeThemeProfile(*imported, themeProfileStyle{font: "Imported User Font", size: 19, overrides: `{"background":"#eeeeee"}`})
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(dark)))
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(*imported)))
	require.NoError(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: imported.ID, FollowInterfaceMode: true}))

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

func TestThemeServiceRejectsInvalidFixedAssignment(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	assignments, err := themeService.GetAssignments()
	require.NoError(t, err)
	assignments.FollowInterfaceMode = false
	assignments.FixedProfileID = 99999
	require.NoError(t, store.SaveThemeAssignments(db, assignments))

	err = themeService.InitializeDefaults()
	assert.ErrorContains(t, err, "fixed theme profile: get theme profile")
}

func TestThemeServiceRejectsStoredAssignmentStatesWithoutRepair(t *testing.T) {
	tests := []struct {
		name  string
		setup func(*testing.T, *sql.DB)
		want  string
	}{
		{name: "partial", setup: deleteFixedAssignment, want: "incomplete"},
		{name: "zero", setup: saveZeroAssignments, want: "fixed theme profile is required"},
		{name: "corrupt", setup: corruptDarkAssignment, want: "parse theme assignment"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			themeService := NewThemeService(db, testutil.NewTestLogger())
			require.NoError(t, themeService.InitializeDefaults())
			test.setup(t, db)
			before := storedThemeAssignmentValues(t, db)

			err := themeService.InitializeDefaults()
			assert.ErrorContains(t, err, test.want)
			assert.Equal(t, before, storedThemeAssignmentValues(t, db))
		})
	}
}

func deleteFixedAssignment(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`DELETE FROM settings WHERE key = 'terminal.theme.fixed_profile_id'`)
	require.NoError(t, err)
}

func saveZeroAssignments(t *testing.T, db *sql.DB) {
	t.Helper()
	require.NoError(t, store.SaveThemeAssignments(db, model.ThemeAssignments{}))
}

func corruptDarkAssignment(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`UPDATE settings SET value = 'invalid' WHERE key = 'terminal.theme.dark_profile_id'`)
	require.NoError(t, err)
}

func storedThemeAssignmentValues(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(`SELECT key || '=' || value FROM settings WHERE key LIKE 'terminal.theme.%' ORDER BY key`)
	require.NoError(t, err)
	values := make([]string, 0, 4)
	for rows.Next() {
		var value string
		require.NoError(t, rows.Scan(&value))
		values = append(values, value)
	}
	require.NoError(t, rows.Err())
	require.NoError(t, rows.Close())
	return values
}

func TestThemeServiceResetsAndDeduplicatesFixedBuiltinStyle(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := customizeThemeProfile(mustThemeProfileNamed(t, profiles, "Dracula"), themeProfileStyle{font: "Dark User Font", size: 20, overrides: `{"background":"#111111"}`})
	light := customizeThemeProfile(mustThemeProfileNamed(t, profiles, "GitHub Light"), themeProfileStyle{font: "Light User Font", size: 18, overrides: `{"background":"#eeeeee"}`})
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(dark)))
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(light)))
	require.NoError(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{
		DarkProfileID:       dark.ID,
		LightProfileID:      light.ID,
		FollowInterfaceMode: false,
		FixedProfileID:      dark.ID,
	}))
	_, err := db.Exec(`CREATE TABLE reset_counts (profile_id INTEGER NOT NULL)`)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TRIGGER count_shared_theme_reset AFTER UPDATE ON terminal_theme_profiles WHEN OLD.id = ` + themeProfileID(dark.ID) + ` BEGIN INSERT INTO reset_counts(profile_id) VALUES (NEW.id); END`)
	require.NoError(t, err)

	result, err := themeService.ResetBuiltinStyles()
	require.NoError(t, err)
	assert.True(t, result.DarkReset)
	assert.True(t, result.LightReset)
	assert.True(t, result.FixedReset)
	var updates int
	require.NoError(t, db.QueryRow("SELECT COUNT(*) FROM reset_counts WHERE profile_id = ?", dark.ID).Scan(&updates))
	assert.Equal(t, 1, updates)
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
	require.NoError(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: importedID, LightProfileID: light.ID, FollowInterfaceMode: true}))

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
	dark := customizeThemeProfile(mustThemeProfileNamed(t, profiles, "GitHub Dark"), themeProfileStyle{font: "Dark User Font", size: 21, overrides: `{"background":"#111111"}`})
	light := customizeThemeProfile(mustThemeProfileNamed(t, profiles, "GitHub Light"), themeProfileStyle{font: "Light User Font", size: 18, overrides: `{"background":"#eeeeee"}`})
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(dark)))
	require.NoError(t, themeService.UpdateProfile(model.ThemeProfileInputFrom(light)))
	require.NoError(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: light.ID, FollowInterfaceMode: true}))
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
