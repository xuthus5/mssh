package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

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
		GlobalStyle: validTerminalGlobalStyleInput(),
		Profiles:    []model.ThemeProfileInput{validThemeProfileInput(1), validThemeProfileInput(2)},
		Assignments: model.ThemeAssignmentsInput{DarkProfileID: 1, LightProfileID: 2, FollowInterfaceMode: true},
	}))
	_, err = themeService.ResetBuiltinStyles()
	assert.ErrorContains(t, err, "prepare built-in theme reset")
}

func TestThemeServiceRequiresExistingFixedProfileWhenSet(t *testing.T) {
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	assignments, err := themeService.GetAssignments()
	require.NoError(t, err)

	err = themeService.SaveAssignments(model.ThemeAssignmentsInput{
		DarkProfileID:       assignments.DarkProfileID,
		LightProfileID:      assignments.LightProfileID,
		FollowInterfaceMode: true,
		FixedProfileID:      99999,
	})
	assert.ErrorContains(t, err, "fixed theme profile")
}

func validThemeProfileInput(themeID int64) model.ThemeProfileInput {
	return model.ThemeProfileInput{Name: "Valid", ThemeID: themeID, FontFamily: "mono", FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`}
}
