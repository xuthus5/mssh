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

func TestThemeServiceInitializesDefaultsAndAssignments(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, service.InitializeDefaults())
	require.NoError(t, service.InitializeDefaults())

	definitions, err := service.ListDefinitions("")
	require.NoError(t, err)
	assert.Len(t, definitions, 24)
	profiles, err := service.ListProfiles("")
	require.NoError(t, err)
	assert.Len(t, profiles, 24)
	assignments, err := service.GetAssignments()
	require.NoError(t, err)
	assert.NotZero(t, assignments.DarkProfileID)
	assert.NotZero(t, assignments.LightProfileID)
	assert.True(t, assignments.FollowInterfaceMode)
	assert.Zero(t, assignments.FixedProfileID)
}

func TestThemeServiceImportsFilesWithPartialResults(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, service.InitializeDefaults())
	directory := t.TempDir()
	validPath := filepath.Join(directory, "Imported.itermcolors")
	require.NoError(t, os.WriteFile(validPath, []byte(serviceITermFixture()), 0o600))
	unsupportedPath := filepath.Join(directory, "theme.json")
	require.NoError(t, os.WriteFile(unsupportedPath, []byte(`{}`), 0o600))

	first, err := service.ImportFiles([]string{validPath, unsupportedPath})
	require.NoError(t, err)
	require.Len(t, first.Results, 2)
	assert.Equal(t, model.ThemeImportImported, first.Results[0].Status)
	assert.Equal(t, model.ThemeImportFailed, first.Results[1].Status)

	second, err := service.ImportFiles([]string{validPath})
	require.NoError(t, err)
	assert.Equal(t, model.ThemeImportDuplicate, second.Results[0].Status)
}

func TestThemeServiceImportReportsFileAndDatabaseFailures(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	directory := t.TempDir()
	oversizedPath := filepath.Join(directory, "oversized.itermcolors")
	require.NoError(t, os.WriteFile(oversizedPath, make([]byte, maxThemeImportBytes+1), 0o600))
	malformedPath := filepath.Join(directory, "malformed.itermcolors")
	require.NoError(t, os.WriteFile(malformedPath, []byte(`<plist><dict>`), 0o600))
	validPath := filepath.Join(directory, "valid.itermcolors")
	require.NoError(t, os.WriteFile(validPath, []byte(serviceITermFixture()), 0o600))

	summary, err := themeService.ImportFiles([]string{filepath.Join(directory, "missing.itermcolors"), oversizedPath, malformedPath})
	require.NoError(t, err)
	require.Len(t, summary.Results, 3)
	for _, result := range summary.Results {
		assert.Equal(t, model.ThemeImportFailed, result.Status)
		assert.NotEmpty(t, result.Error)
	}

	require.NoError(t, db.Close())
	summary, err = themeService.ImportFiles([]string{validPath})
	require.NoError(t, err)
	require.Len(t, summary.Results, 1)
	assert.Equal(t, model.ThemeImportFailed, summary.Results[0].Status)
	assert.Contains(t, summary.Results[0].Error, "begin theme import")
}

func serviceITermFixture() string {
	entries := []string{}
	keys := []string{"Background Color", "Foreground Color", "Cursor Color", "Selection Color"}
	for _, key := range keys {
		entries = append(entries, `<key>`+key+`</key><dict><key>Red Component</key><real>0.2</real><key>Green Component</key><real>0.3</real><key>Blue Component</key><real>0.4</real></dict>`)
	}
	for index := range 16 {
		entries = append(entries, fmt.Sprintf(`<key>Ansi %d Color</key><dict><key>Red Component</key><real>0.2</real><key>Green Component</key><real>0.3</real><key>Blue Component</key><real>0.4</real></dict>`, index))
	}
	return `<plist><dict>` + strings.Join(entries, "") + `</dict></plist>`
}

func TestThemeServiceProfileValidationAndAssignments(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, service.InitializeDefaults())
	definitions, err := service.ListDefinitions(string(model.ThemeModeDark))
	require.NoError(t, err)

	_, err = service.CreateCustomProfile(model.ThemeProfileInput{Name: "Invalid", ThemeID: definitions[0].ID, FontFamily: "mono", FontSize: 2, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`})
	assert.Error(t, err)
	created, err := service.CreateCustomProfile(model.ThemeProfileInput{Name: "Custom", ThemeID: definitions[0].ID, FontFamily: "mono", FontSize: 15, CursorStyle: model.CursorStyleUnderline, ColorOverrides: `{}`})
	require.NoError(t, err)
	created.Name = "Renamed"
	require.NoError(t, service.UpdateProfile(model.ThemeProfileInputFrom(*created)))

	assignments, err := service.GetAssignments()
	require.NoError(t, err)
	require.NoError(t, service.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: created.ID, LightProfileID: assignments.LightProfileID, FollowInterfaceMode: true}))
	assert.Error(t, service.DeleteProfile(created.ID))
	assert.Error(t, service.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: created.ID, LightProfileID: assignments.LightProfileID, FollowInterfaceMode: false}))
	assert.Error(t, service.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: created.ID, LightProfileID: assignments.LightProfileID, FollowInterfaceMode: false, FixedProfileID: 99999}))
	invalidInputs := []model.ThemeProfileInput{
		{Name: "", ThemeID: definitions[0].ID, FontFamily: "mono", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`},
		{Name: "Invalid cursor", ThemeID: definitions[0].ID, FontFamily: "mono", FontSize: 14, CursorStyle: "beam", ColorOverrides: `{}`},
		{Name: "Invalid JSON", ThemeID: definitions[0].ID, FontFamily: "mono", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{`},
	}
	for _, input := range invalidInputs {
		_, err = service.CreateCustomProfile(input)
		assert.Error(t, err)
	}
}

func TestThemeServiceSavesCrossModeConfigurationAndManagesCustomThemes(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles, err := themeService.ListProfiles("")
	require.NoError(t, err)
	require.Len(t, profiles, 24)

	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	dark.Name = "Dark Edited"
	light.Name = "Light Edited"
	require.NoError(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{
		Profiles:    []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(light)},
		Assignments: model.ThemeAssignmentsInput{DarkProfileID: light.ID, LightProfileID: dark.ID, FollowInterfaceMode: true},
	}))

	assignments, err := themeService.GetAssignments()
	require.NoError(t, err)
	assert.Equal(t, light.ID, assignments.DarkProfileID)
	assert.Equal(t, dark.ID, assignments.LightProfileID)
	stored, err := themeService.GetProfile(dark.ID)
	require.NoError(t, err)
	assert.Equal(t, "Dark Edited", stored.Name)

	assert.Error(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: -1, LightProfileID: light.ID, FollowInterfaceMode: true}))
	assert.Error(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: -1, FollowInterfaceMode: true}))
	assert.Error(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{Profiles: []model.ThemeProfileInput{{Name: "invalid"}}}))
	assert.Error(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{
		Profiles: []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), {Name: "invalid"}},
	}))
	missingDark := model.ThemeProfileInputFrom(dark)
	missingDark.ID = -1
	assert.Error(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{
		Profiles: []model.ThemeProfileInput{missingDark, model.ThemeProfileInputFrom(light)},
	}))
	assert.ErrorContains(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{
		Profiles:    []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(dark)},
		Assignments: model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: light.ID, FollowInterfaceMode: true},
	}), "duplicate theme profile")
	_, err = themeService.ListDefinitions("sepia")
	assert.Error(t, err)
	_, err = themeService.ListProfiles("sepia")
	assert.Error(t, err)
	assert.Error(t, themeService.DeleteDefinition(profiles[0].ThemeID))
}

func TestThemeServiceSavesFixedConfigurationAndRollsBackProfileUpdates(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	fixed := mustThemeProfileNamed(t, profiles, "Dracula")

	require.NoError(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{
		Profiles: []model.ThemeProfileInput{
			model.ThemeProfileInputFrom(dark),
			model.ThemeProfileInputFrom(light),
			model.ThemeProfileInputFrom(fixed),
		},
		Assignments: model.ThemeAssignmentsInput{
			DarkProfileID:       dark.ID,
			LightProfileID:      light.ID,
			FollowInterfaceMode: false,
			FixedProfileID:      fixed.ID,
		},
	}))
	assignments, err := themeService.GetAssignments()
	require.NoError(t, err)
	assert.False(t, assignments.FollowInterfaceMode)
	assert.Equal(t, fixed.ID, assignments.FixedProfileID)

	dark.Name = "Must Roll Back"
	_, err = db.Exec(`CREATE TRIGGER fail_light_profile_update BEFORE UPDATE ON terminal_theme_profiles WHEN OLD.id = ` + themeProfileID(light.ID) + ` BEGIN SELECT RAISE(FAIL, 'light profile update failed'); END`)
	require.NoError(t, err)
	err = themeService.SaveConfiguration(model.ThemeConfigurationInput{
		Profiles: []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(light)},
		Assignments: model.ThemeAssignmentsInput{
			DarkProfileID:       dark.ID,
			LightProfileID:      light.ID,
			FollowInterfaceMode: true,
			FixedProfileID:      fixed.ID,
		},
	})
	assert.ErrorContains(t, err, "light profile update failed")
	storedDark, getErr := themeService.GetProfile(dark.ID)
	require.NoError(t, getErr)
	assert.NotEqual(t, "Must Roll Back", storedDark.Name)
}

func TestThemeServiceSaveAssignmentsRollsBackPartialWrites(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	fixed := mustThemeProfileNamed(t, profiles, "Dracula")
	before, err := themeService.GetAssignments()
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TRIGGER fail_fixed_assignment BEFORE UPDATE ON settings WHEN NEW.key = 'terminal.theme.fixed_profile_id' BEGIN SELECT RAISE(FAIL, 'fixed assignment failed'); END`)
	require.NoError(t, err)

	err = themeService.SaveAssignments(model.ThemeAssignmentsInput{
		DarkProfileID:       fixed.ID,
		LightProfileID:      light.ID,
		FollowInterfaceMode: false,
		FixedProfileID:      dark.ID,
	})
	assert.ErrorContains(t, err, "save theme assignments")
	after, getErr := store.GetThemeAssignments(db)
	require.NoError(t, getErr)
	assert.Equal(t, before, after)
}

func TestThemeServiceDeletesHistoricalFixedProfileTransactionally(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	historical, err := themeService.CreateCustomProfile(model.ThemeProfileInput{
		Name: "Historical Fixed", ThemeID: dark.ThemeID, FontFamily: "monospace", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`,
	})
	require.NoError(t, err)
	require.NoError(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{
		DarkProfileID: dark.ID, LightProfileID: light.ID, FollowInterfaceMode: true, FixedProfileID: historical.ID,
	}))

	_, err = db.Exec(`CREATE TRIGGER fail_historical_profile_delete BEFORE DELETE ON terminal_theme_profiles WHEN OLD.id = ` + themeProfileID(historical.ID) + ` BEGIN SELECT RAISE(FAIL, 'historical profile delete failed'); END`)
	require.NoError(t, err)
	err = themeService.DeleteProfile(historical.ID)
	assert.ErrorContains(t, err, "historical profile delete failed")
	_, err = themeService.GetProfile(historical.ID)
	require.NoError(t, err)
	assignments, err := themeService.GetAssignments()
	require.NoError(t, err)
	assert.Equal(t, historical.ID, assignments.FixedProfileID)

	_, err = db.Exec(`DROP TRIGGER fail_historical_profile_delete`)
	require.NoError(t, err)
	require.NoError(t, themeService.DeleteProfile(historical.ID))
	_, err = themeService.GetProfile(historical.ID)
	assert.Error(t, err)
	assignments, err = themeService.GetAssignments()
	require.NoError(t, err)
	assert.Zero(t, assignments.FixedProfileID)
}

func TestThemeServiceReportsDatabaseFailures(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, db.Close())

	assert.Error(t, themeService.InitializeDefaults())
	_, err := themeService.ListDefinitions("")
	assert.Error(t, err)
	_, err = themeService.ListProfiles("")
	assert.Error(t, err)
	_, err = themeService.GetProfile(1)
	assert.Error(t, err)
	_, err = themeService.CreateCustomProfile(validThemeProfileInput(1))
	assert.Error(t, err)
	assert.Error(t, themeService.UpdateProfile(validThemeProfileInput(1)))
	assert.Error(t, themeService.DeleteProfile(1))
	assert.Error(t, themeService.DeleteDefinition(1))
	_, err = themeService.GetAssignments()
	assert.Error(t, err)
	assert.Error(t, themeService.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: 1, LightProfileID: 2, FollowInterfaceMode: true}))
	assert.Error(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{
		Profiles:    []model.ThemeProfileInput{validThemeProfileInput(1), validThemeProfileInput(2)},
		Assignments: model.ThemeAssignmentsInput{DarkProfileID: 1, LightProfileID: 2, FollowInterfaceMode: true},
	}))
	_, err = themeService.ResetBuiltinStyles()
	assert.ErrorContains(t, err, "prepare built-in theme reset")
}

func validThemeProfileInput(themeID int64) model.ThemeProfileInput {
	return model.ThemeProfileInput{Name: "Valid", ThemeID: themeID, FontFamily: "mono", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`}
}
