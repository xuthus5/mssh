package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestThemeServiceInitializesDefaultsAndAssignments(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, service.InitializeDefaults())
	require.NoError(t, service.InitializeDefaults())

	definitions, err := service.ListDefinitions("")
	require.NoError(t, err)
	assert.Len(t, definitions, 2)
	profiles, err := service.ListProfiles("")
	require.NoError(t, err)
	assert.Len(t, profiles, 2)
	assignments, err := service.GetAssignments()
	require.NoError(t, err)
	assert.NotZero(t, assignments.DarkProfileID)
	assert.NotZero(t, assignments.LightProfileID)
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
	require.NoError(t, service.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: created.ID, LightProfileID: assignments.LightProfileID}))
	assert.Error(t, service.DeleteProfile(created.ID))
}
