package store

import (
	"errors"
	"io/fs"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

type coverageStubDBFile struct {
	closed bool
	err    error
}

func (s *coverageStubDBFile) Close() error {
	s.closed = true
	return s.err
}

func (s *coverageStubDBFile) Chmod(fs.FileMode) error { return nil }

func TestCloseDBFileAndTagIDsHelpers(t *testing.T) {
	file := &coverageStubDBFile{}
	require.NoError(t, closeDBFile(file))
	assert.True(t, file.closed)

	file = &coverageStubDBFile{err: errors.New("boom")}
	require.ErrorContains(t, closeDBFile(file), "close database file")

	ids := tagIDsFromAssets([]model.AssetTag{{ID: 3}, {ID: 5}})
	assert.Equal(t, []int64{3, 5}, ids)
	assert.Empty(t, tagIDsFromAssets(nil))
}

func TestParseThemeAssignmentsSuccessAndErrors(t *testing.T) {
	values := map[string]string{
		darkThemeProfileKey:  "1",
		lightThemeProfileKey: "2",
		fixedThemeProfileKey: "3",
		followThemeModeKey:   "true",
	}
	assignments, err := parseThemeAssignments(values)
	require.NoError(t, err)
	assert.Equal(t, int64(1), assignments.DarkProfileID)
	assert.Equal(t, int64(2), assignments.LightProfileID)
	assert.Equal(t, int64(3), assignments.FixedProfileID)
	assert.True(t, assignments.FollowInterfaceMode)

	_, err = parseThemeAssignments(map[string]string{darkThemeProfileKey: "x"})
	require.Error(t, err)
	_, err = parseThemeAssignments(map[string]string{
		darkThemeProfileKey: "1", lightThemeProfileKey: "bad",
	})
	require.Error(t, err)
}

func TestDeleteAndSetDefaultFolder(t *testing.T) {
	db := setupTestDB(t)
	folder, err := CreateFolder(db, "work", nil)
	require.NoError(t, err)
	require.NoError(t, SetDefaultFolder(db, folder.ID))
	folders, err := ListFolders(db)
	require.NoError(t, err)
	var defaultCount int
	for _, item := range folders {
		if item.IsDefault {
			defaultCount++
			assert.Equal(t, folder.ID, item.ID)
		}
	}
	assert.Equal(t, 1, defaultCount)
	// cannot delete current default
	require.Error(t, DeleteFolder(db, folder.ID))
	// create another and delete non-default
	other, err := CreateFolder(db, "archive", nil)
	require.NoError(t, err)
	require.NoError(t, DeleteFolder(db, other.ID))
}

func TestParseThemeAssignmentBool(t *testing.T) {
	value, err := parseThemeAssignmentBool(map[string]string{followThemeModeKey: "false"}, followThemeModeKey)
	require.NoError(t, err)
	assert.False(t, value)
	_, err = parseThemeAssignmentBool(map[string]string{followThemeModeKey: "maybe"}, followThemeModeKey)
	require.Error(t, err)
}
