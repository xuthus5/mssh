package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestThemeServiceInitializesAndRejectsCorruptTerminalGlobalStyle(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())

	style, err := themeService.GetGlobalStyle()
	require.NoError(t, err)
	assert.Equal(t, terminalStyleDefaults(), style)
	for _, profile := range mustThemeProfiles(t, themeService) {
		assert.True(t, profile.FollowGlobalStyle, profile.Name)
	}

	_, err = db.Exec(`UPDATE settings SET value = '"large"' WHERE key = 'terminal.style.font_size'`)
	require.NoError(t, err)
	err = themeService.InitializeDefaults()
	assert.ErrorContains(t, err, "terminal.style.font_size")
	var stored string
	require.NoError(t, db.QueryRow(`SELECT value FROM settings WHERE key = 'terminal.style.font_size'`).Scan(&stored))
	assert.Equal(t, `"large"`, stored)
}

func TestThemeServiceValidatesGlobalAndProfileFallbackStyles(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	assignments := model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: light.ID, FollowInterfaceMode: true}

	invalidStyles := []model.TerminalGlobalStyleInput{
		{FontFamily: "", FontSize: 14, CursorStyle: model.CursorStyleBar},
		{FontFamily: "mono", FontSize: 7, CursorStyle: model.CursorStyleBar},
		{FontFamily: "mono", FontSize: 14, CursorStyle: "beam"},
	}
	for _, style := range invalidStyles {
		err := themeService.SaveConfiguration(model.ThemeConfigurationInput{
			GlobalStyle: style,
			Profiles:    []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(light)},
			Assignments: assignments,
		})
		assert.Error(t, err)
	}

	dark.FollowGlobalStyle = true
	dark.FontSize = 2
	err := themeService.SaveConfiguration(model.ThemeConfigurationInput{
		GlobalStyle: model.TerminalGlobalStyleInputFrom(terminalStyleDefaults()),
		Profiles:    []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(light)},
		Assignments: assignments,
	})
	assert.ErrorContains(t, err, "font size")
}

func TestThemeServiceSavesTerminalConfigurationAtomically(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	beforeStyle, err := themeService.GetGlobalStyle()
	require.NoError(t, err)
	beforeAssignments, err := themeService.GetAssignments()
	require.NoError(t, err)

	dark.Name = "Must Roll Back"
	_, err = db.Exec(`CREATE TRIGGER fail_global_style BEFORE UPDATE ON settings WHEN NEW.key = 'terminal.style.font_size' BEGIN SELECT RAISE(FAIL, 'global style failed'); END`)
	require.NoError(t, err)
	err = themeService.SaveConfiguration(model.ThemeConfigurationInput{
		GlobalStyle: model.TerminalGlobalStyleInput{FontFamily: "\x00 Iosevka \n", FontSize: 17, CursorStyle: model.CursorStyleUnderline},
		Profiles:    []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(light)},
		Assignments: model.ThemeAssignmentsInput{DarkProfileID: light.ID, LightProfileID: dark.ID, FollowInterfaceMode: true},
	})
	assert.ErrorContains(t, err, "global style failed")
	_, err = db.Exec("DROP TRIGGER fail_global_style")
	require.NoError(t, err)

	storedDark, getErr := themeService.GetProfile(dark.ID)
	require.NoError(t, getErr)
	assert.NotEqual(t, "Must Roll Back", storedDark.Name)
	afterStyle, getErr := themeService.GetGlobalStyle()
	require.NoError(t, getErr)
	assert.Equal(t, beforeStyle, afterStyle)
	afterAssignments, getErr := themeService.GetAssignments()
	require.NoError(t, getErr)
	assert.Equal(t, beforeAssignments, afterAssignments)
}

func TestThemeServiceRollsBackWhenConfigurationAssignmentWriteFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	fixed := mustThemeProfileNamed(t, profiles, "Dracula")
	beforeStyle, err := themeService.GetGlobalStyle()
	require.NoError(t, err)
	beforeAssignments, err := themeService.GetAssignments()
	require.NoError(t, err)
	dark.Name = "Must Roll Back"
	_, err = db.Exec(`CREATE TRIGGER fail_configuration_assignment BEFORE UPDATE ON settings WHEN NEW.key = 'terminal.theme.fixed_profile_id' BEGIN SELECT RAISE(FAIL, 'assignment failed'); END`)
	require.NoError(t, err)
	err = themeService.SaveConfiguration(model.ThemeConfigurationInput{
		GlobalStyle: model.TerminalGlobalStyleInput{FontFamily: "Changed Font", FontSize: 18, CursorStyle: model.CursorStyleBlock},
		Profiles:    []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(light), model.ThemeProfileInputFrom(fixed)},
		Assignments: model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: light.ID, FollowInterfaceMode: false, FixedProfileID: fixed.ID},
	})
	assert.ErrorContains(t, err, "assignment failed")
	_, err = db.Exec("DROP TRIGGER fail_configuration_assignment")
	require.NoError(t, err)
	storedDark, err := themeService.GetProfile(dark.ID)
	require.NoError(t, err)
	assert.NotEqual(t, "Must Roll Back", storedDark.Name)
	storedStyle, err := themeService.GetGlobalStyle()
	require.NoError(t, err)
	assert.Equal(t, beforeStyle, storedStyle)
	storedAssignments, err := themeService.GetAssignments()
	require.NoError(t, err)
	assert.Equal(t, beforeAssignments, storedAssignments)
}

func TestThemeServiceNormalizesAndResetsTerminalStyles(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	dark.FollowGlobalStyle = false
	dark.FontFamily = "Profile Font"
	dark.FontSize = 20
	dark.CursorStyle = model.CursorStyleBlock
	global := model.TerminalGlobalStyleInput{FontFamily: "\x00 Iosevka \n", FontSize: 17, CursorStyle: model.CursorStyleUnderline}
	require.NoError(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{
		GlobalStyle: global,
		Profiles:    []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(light)},
		Assignments: model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: light.ID, FollowInterfaceMode: true},
	}))

	storedGlobal, err := themeService.GetGlobalStyle()
	require.NoError(t, err)
	assert.Equal(t, "Iosevka", storedGlobal.FontFamily)
	_, err = themeService.ResetBuiltinStyles()
	require.NoError(t, err)
	resetDark, err := themeService.GetProfile(dark.ID)
	require.NoError(t, err)
	assert.True(t, resetDark.FollowGlobalStyle)
	assert.Equal(t, model.DefaultTerminalFontFamily, resetDark.FontFamily)
	assert.Equal(t, model.DefaultTerminalFontSize, resetDark.FontSize)
	assert.Equal(t, model.CursorStyleBar, resetDark.CursorStyle)
	afterReset, err := themeService.GetGlobalStyle()
	require.NoError(t, err)
	assert.Equal(t, storedGlobal, afterReset)
}

func TestThemeServiceLimitsGlobalFontFamilyAndReportsClosedDatabase(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	longFontFamily := strings.Repeat("字", maxTerminalFontFamilyRunes+10)
	require.NoError(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{
		GlobalStyle: model.TerminalGlobalStyleInput{FontFamily: longFontFamily, FontSize: 14, CursorStyle: model.CursorStyleBar},
		Profiles:    []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(light)},
		Assignments: model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: light.ID, FollowInterfaceMode: true},
	}))
	style, err := themeService.GetGlobalStyle()
	require.NoError(t, err)
	assert.Len(t, []rune(style.FontFamily), maxTerminalFontFamilyRunes)

	require.NoError(t, db.Close())
	_, err = themeService.GetGlobalStyle()
	assert.Error(t, err)
}

func TestThemeServiceNormalizesProfileFallbackFontFamily(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	dark := mustThemeProfileNamed(t, profiles, "GitHub Dark")
	light := mustThemeProfileNamed(t, profiles, "GitHub Light")
	dark.FollowGlobalStyle = false
	dark.FontFamily = "\x00 " + strings.Repeat("字", maxTerminalFontFamilyRunes+10) + "\n"
	require.NoError(t, themeService.SaveConfiguration(model.ThemeConfigurationInput{
		GlobalStyle: model.TerminalGlobalStyleInputFrom(terminalStyleDefaults()),
		Profiles:    []model.ThemeProfileInput{model.ThemeProfileInputFrom(dark), model.ThemeProfileInputFrom(light)},
		Assignments: model.ThemeAssignmentsInput{DarkProfileID: dark.ID, LightProfileID: light.ID, FollowInterfaceMode: true},
	}))

	stored, err := themeService.GetProfile(dark.ID)
	require.NoError(t, err)
	assert.Len(t, []rune(stored.FontFamily), maxTerminalFontFamilyRunes)
	assert.NotContains(t, stored.FontFamily, "\x00")
	assert.NotContains(t, stored.FontFamily, "\n")
}

func TestNewCustomAndImportedProfilesFollowGlobalStyle(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	definitions, err := themeService.ListDefinitions(string(model.ThemeModeDark))
	require.NoError(t, err)
	created, err := themeService.CreateCustomProfile(model.ThemeProfileInput{
		Name: "Custom", ThemeID: definitions[0].ID, FontFamily: "mono", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`,
	})
	require.NoError(t, err)
	assert.True(t, created.FollowGlobalStyle)

	path := filepath.Join(t.TempDir(), "Imported.itermcolors")
	require.NoError(t, os.WriteFile(path, []byte(serviceITermFixture()), 0o600))
	summary, err := themeService.ImportFiles([]string{path})
	require.NoError(t, err)
	require.NotZero(t, summary.Results[0].ProfileID)
	imported, err := themeService.GetProfile(summary.Results[0].ProfileID)
	require.NoError(t, err)
	assert.True(t, imported.FollowGlobalStyle)
}

func terminalStyleDefaults() model.TerminalGlobalStyle {
	return model.TerminalGlobalStyle{
		FontFamily:  model.DefaultTerminalFontFamily,
		FontSize:    model.DefaultTerminalFontSize,
		CursorStyle: model.CursorStyleBar,
	}
}
