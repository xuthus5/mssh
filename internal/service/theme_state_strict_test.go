package service

import (
	"database/sql"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type storedSetting struct {
	key, namespace, value, valueType, updatedAt string
	version                                     int
}

type strictThemeFixture struct {
	db      *sql.DB
	service *ThemeService
	dark    model.ThemeProfile
	light   model.ThemeProfile
}

func TestSaveAssignmentsRejectsInvalidCurrentStateWithoutWrites(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*testing.T, strictThemeFixture)
	}{
		{name: "partial", mutate: deleteCurrentFixedAssignment},
		{name: "metadata", mutate: corruptCurrentAssignmentMetadata},
		{name: "corrupt", mutate: corruptCurrentAssignmentValue},
		{name: "zero", mutate: zeroCurrentAssignments},
		{name: "missing reference", mutate: removeCurrentDarkReference},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newStrictThemeFixture(t)
			test.mutate(t, fixture)
			before := loadStoredSettings(t, fixture.db)

			err := fixture.service.SaveAssignments(model.ThemeAssignmentsInput{
				DarkProfileID: fixture.light.ID, LightProfileID: fixture.dark.ID, FollowInterfaceMode: true,
			})

			require.Error(t, err)
			assert.Equal(t, before, loadStoredSettings(t, fixture.db))
		})
	}
}

func TestSaveConfigurationRejectsInvalidCurrentAssignmentsWithoutWrites(t *testing.T) {
	mutations := []struct {
		name   string
		mutate func(*testing.T, strictThemeFixture)
	}{
		{name: "partial", mutate: deleteCurrentFixedAssignment},
		{name: "metadata", mutate: corruptCurrentAssignmentMetadata},
		{name: "corrupt", mutate: corruptCurrentAssignmentValue},
		{name: "zero", mutate: zeroCurrentAssignments},
		{name: "missing reference", mutate: removeCurrentDarkReference},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			fixture := newStrictThemeFixture(t)
			mutation.mutate(t, fixture)
			assertConfigurationRejectedWithoutWrites(t, fixture)
		})
	}
}

func TestSaveConfigurationRejectsInvalidCurrentGlobalStyleWithoutWrites(t *testing.T) {
	mutations := []struct {
		name, query string
	}{
		{name: "partial", query: `DELETE FROM settings WHERE key = 'terminal.style.cursor_style'`},
		{name: "metadata", query: `UPDATE settings SET version = 2 WHERE key = 'terminal.style.font_family'`},
		{name: "corrupt", query: `UPDATE settings SET value = '{' WHERE key = 'terminal.style.font_family'`},
		{name: "invalid", query: `UPDATE settings SET value = '2' WHERE key = 'terminal.style.font_size'`},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			fixture := newStrictThemeFixture(t)
			_, err := fixture.db.Exec(mutation.query)
			require.NoError(t, err)
			assertConfigurationRejectedWithoutWrites(t, fixture)
		})
	}
}

func newStrictThemeFixture(t *testing.T) strictThemeFixture {
	t.Helper()
	db := testutil.NewTestDB(t)
	themeService := NewThemeService(db, testutil.NewTestLogger())
	require.NoError(t, themeService.InitializeDefaults())
	profiles := mustThemeProfiles(t, themeService)
	return strictThemeFixture{
		db: db, service: themeService,
		dark:  mustThemeProfileNamed(t, profiles, "GitHub Dark"),
		light: mustThemeProfileNamed(t, profiles, "GitHub Light"),
	}
}

func assertConfigurationRejectedWithoutWrites(t *testing.T, fixture strictThemeFixture) {
	t.Helper()
	beforeSettings := loadStoredSettings(t, fixture.db)
	beforeName := storedThemeProfileName(t, fixture.db, fixture.dark.ID)
	fixture.dark.Name = "Must Not Be Written"
	err := fixture.service.SaveConfiguration(model.ThemeConfigurationInput{
		GlobalStyle: validTerminalGlobalStyleInput(),
		Profiles: []model.ThemeProfileInput{
			model.ThemeProfileInputFrom(fixture.dark), model.ThemeProfileInputFrom(fixture.light),
		},
		Assignments: model.ThemeAssignmentsInput{
			DarkProfileID: fixture.light.ID, LightProfileID: fixture.dark.ID, FollowInterfaceMode: true,
		},
	})
	require.Error(t, err)
	assert.Equal(t, beforeSettings, loadStoredSettings(t, fixture.db))
	assert.Equal(t, beforeName, storedThemeProfileName(t, fixture.db, fixture.dark.ID))
}

func deleteCurrentFixedAssignment(t *testing.T, fixture strictThemeFixture) {
	t.Helper()
	_, err := fixture.db.Exec(`DELETE FROM settings WHERE key = 'terminal.theme.fixed_profile_id'`)
	require.NoError(t, err)
}

func corruptCurrentAssignmentMetadata(t *testing.T, fixture strictThemeFixture) {
	t.Helper()
	_, err := fixture.db.Exec(`UPDATE settings SET updated_at = 'invalid' WHERE key = 'terminal.theme.dark_profile_id'`)
	require.NoError(t, err)
}

func corruptCurrentAssignmentValue(t *testing.T, fixture strictThemeFixture) {
	t.Helper()
	_, err := fixture.db.Exec(`UPDATE settings SET value = 'invalid' WHERE key = 'terminal.theme.dark_profile_id'`)
	require.NoError(t, err)
}

func zeroCurrentAssignments(t *testing.T, fixture strictThemeFixture) {
	t.Helper()
	require.NoError(t, store.SaveThemeAssignments(fixture.db, model.ThemeAssignments{}))
}

func removeCurrentDarkReference(t *testing.T, fixture strictThemeFixture) {
	t.Helper()
	_, err := fixture.db.Exec(`UPDATE settings SET value = '999999' WHERE key = 'terminal.theme.dark_profile_id'`)
	require.NoError(t, err)
}

func loadStoredSettings(t *testing.T, db *sql.DB) []storedSetting {
	t.Helper()
	rows, err := db.Query(`SELECT key, namespace, value, value_type, version, updated_at FROM settings WHERE key LIKE 'terminal.style.%' OR key LIKE 'terminal.theme.%' ORDER BY key`)
	require.NoError(t, err)
	defer func() { require.NoError(t, rows.Close()) }()
	settings := make([]storedSetting, 0, 7)
	for rows.Next() {
		var setting storedSetting
		require.NoError(t, rows.Scan(
			&setting.key, &setting.namespace, &setting.value, &setting.valueType, &setting.version, &setting.updatedAt,
		))
		settings = append(settings, setting)
	}
	require.NoError(t, rows.Err())
	return settings
}

func storedThemeProfileName(t *testing.T, db *sql.DB, profileID int64) string {
	t.Helper()
	var name string
	err := db.QueryRow(`SELECT name FROM terminal_theme_profiles WHERE id = ?`, profileID).Scan(&name)
	require.NoError(t, err, fmt.Sprintf("load theme profile %d", profileID))
	return name
}
