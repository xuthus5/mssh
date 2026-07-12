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
	require.NoError(t, service.SaveAssignments(model.ThemeAssignmentsInput{DarkProfileID: created.ID, LightProfileID: assignments.LightProfileID}))
	assert.Error(t, service.DeleteProfile(created.ID))
}
