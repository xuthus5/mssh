package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestValidateLocalTransferPath(t *testing.T) {
	_, err := validateLocalTransferPath("  ")
	require.Error(t, err)
	_, err = validateLocalTransferPath("a" + string(rune(0)) + "b")
	require.Error(t, err)
	cleaned, err := validateLocalTransferPath("/tmp/../tmp/file.txt")
	require.NoError(t, err)
	assert.Equal(t, "/tmp/file.txt", cleaned)
}

func TestValidateRemotePath(t *testing.T) {
	require.Error(t, validateRemotePath(""))
	require.Error(t, validateRemotePath("a"+string(rune(0))+"b"))
	require.NoError(t, validateRemotePath("/var/log/app.log"))
}

func TestValidateLocalFilePath(t *testing.T) {
	_, err := validateLocalFilePath("")
	require.Error(t, err)
	_, err = validateLocalFilePath("   ")
	require.Error(t, err)
	cleaned, err := validateLocalFilePath("/tmp/../tmp/out.csv")
	require.NoError(t, err)
	require.Equal(t, "/tmp/out.csv", cleaned)
}

func TestImportExportRejectEmptyLocalPaths(t *testing.T) {
	db := testutil.NewTestDB(t)
	syncSvc := NewSyncService(db, testutil.NewTestLogger())
	require.Error(t, syncSvc.Export(""))
	require.Error(t, syncSvc.Import("   "))
	require.Error(t, syncSvc.ImportWithPassword("", "x"))

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	_, err := sessionSvc.ExportCSV("", model.SessionCSVExportOptions{})
	require.Error(t, err)
	_, err = sessionSvc.ImportCSV("", model.SessionCSVImportOptions{ConflictPolicy: model.SessionCSVConflictSkip})
	require.Error(t, err)
	_, err = sessionSvc.PreviewCSV("")
	require.Error(t, err)

	themeSvc := NewThemeService(db, testutil.NewTestLogger())
	summary, err := themeSvc.ImportFiles([]string{""})
	require.NoError(t, err)
	require.Len(t, summary.Results, 1)
	require.NotEmpty(t, summary.Results[0].Error)
}
