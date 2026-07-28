package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestThemeServiceImportRejectsNonRegularFiles(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewThemeService(db, testutil.NewTestLogger())
	directory := t.TempDir()
	target := filepath.Join(directory, "target.itermcolors")
	require.NoError(t, os.WriteFile(target, []byte(serviceITermFixture()), 0o600))

	tests := []struct {
		name string
		path string
	}{
		{name: "directory", path: directory},
		{name: "symbolic link", path: createThemeSymlink(t, target)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			summary, err := service.ImportFiles([]string{test.path})

			require.NoError(t, err)
			require.Len(t, summary.Results, 1)
			assert.Equal(t, model.ThemeImportFailed, summary.Results[0].Status)
			assert.Contains(t, summary.Results[0].Error, "regular file")
		})
	}
}

func TestThemeServiceImportRejectsOversizedSparseFile(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewThemeService(db, testutil.NewTestLogger())
	path := filepath.Join(t.TempDir(), "oversized.itermcolors")
	require.NoError(t, os.WriteFile(path, nil, 0o600))
	require.NoError(t, os.Truncate(path, maxThemeImportBytes+1))

	summary, err := service.ImportFiles([]string{path})

	require.NoError(t, err)
	require.Len(t, summary.Results, 1)
	assert.Equal(t, model.ThemeImportFailed, summary.Results[0].Status)
	assert.Contains(t, summary.Results[0].Error, "exceeds")
}

func createThemeSymlink(t *testing.T, target string) string {
	t.Helper()
	path := filepath.Join(filepath.Dir(target), "linked.itermcolors")
	if err := os.Symlink(target, path); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	return path
}
