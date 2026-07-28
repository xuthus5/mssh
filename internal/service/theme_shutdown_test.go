package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestThemeServiceShutdownWaitsForActiveDatabaseRead(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewThemeService(database, testutil.NewTestLogger())
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	listDone := make(chan error, 1)
	go func() {
		_, err := service.ListDefinitions("")
		listDone <- err
	}()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()
	assertThemeShutdownPending(t, shutdownDone)
	rollback()
	require.NoError(t, <-listDone)
	assertThemeShutdownCompleted(t, shutdownDone)
	require.NoError(t, database.Ping())
}

func TestThemeServiceRejectsAllOperationsAfterShutdown(t *testing.T) {
	service := NewThemeService(testutil.NewTestDB(t), testutil.NewTestLogger())
	service.Shutdown()
	service.Shutdown()

	_, err := service.ListDefinitions("invalid")
	assertThemeServiceStopped(t, err)
	_, err = service.ListProfiles("invalid")
	assertThemeServiceStopped(t, err)
	_, err = service.GetProfile(0)
	assertThemeServiceStopped(t, err)
	_, err = service.CreateCustomProfile(model.ThemeProfileInput{})
	assertThemeServiceStopped(t, err)
	assertThemeServiceStopped(t, service.UpdateProfile(model.ThemeProfileInput{}))
	assertThemeServiceStopped(t, service.DeleteProfile(0))
	assertThemeServiceStopped(t, service.DeleteDefinition(0))
	_, err = service.GetAssignments()
	assertThemeServiceStopped(t, err)
	_, err = service.GetGlobalStyle()
	assertThemeServiceStopped(t, err)
	assertThemeServiceStopped(t, service.SaveAssignments(model.ThemeAssignmentsInput{}))
	assertThemeServiceStopped(t, service.SaveConfiguration(model.ThemeConfigurationInput{}))
	assertThemeServiceStopped(t, service.InitializeDefaults())
	_, err = service.ResetBuiltinStyles()
	assertThemeServiceStopped(t, err)
	_, err = service.ImportFiles(nil)
	assertThemeServiceStopped(t, err)
}

func TestThemeServiceShutdownHandlesNilReceiver(t *testing.T) {
	var service *ThemeService
	assert.NotPanics(t, service.Shutdown)
	_, err := service.ListDefinitions("")
	assertThemeServiceStopped(t, err)
}

func TestThemeServiceConcurrentDuplicateImportsConverge(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewThemeService(database, testutil.NewTestLogger())
	require.NoError(t, service.InitializeDefaults())
	path := filepath.Join(t.TempDir(), "concurrent.itermcolors")
	require.NoError(t, os.WriteFile(path, []byte(serviceITermFixture()), 0o600))
	rollback := testutil.HoldDatabaseConnection(t, database)
	const workers = 8
	baselineWaits := database.Stats().WaitCount
	start := make(chan struct{})
	results := make(chan model.ThemeImportResult, workers)
	for range workers {
		go importThemeAfterSignal(service, path, start, results)
	}
	close(start)
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+workers)
	rollback()

	counts := map[model.ThemeImportStatus]int{}
	for range workers {
		counts[(<-results).Status]++
	}
	assert.Equal(t, 1, counts[model.ThemeImportImported])
	assert.Equal(t, workers-1, counts[model.ThemeImportDuplicate])
	assert.Zero(t, counts[model.ThemeImportFailed])
}

func importThemeAfterSignal(service *ThemeService, path string, start <-chan struct{}, results chan<- model.ThemeImportResult) {
	<-start
	summary, err := service.ImportFiles([]string{path})
	if err != nil || len(summary.Results) != 1 {
		results <- model.ThemeImportResult{Status: model.ThemeImportFailed}
		return
	}
	results <- summary.Results[0]
}

func assertThemeShutdownPending(t *testing.T, shutdownDone <-chan struct{}) {
	t.Helper()
	select {
	case <-shutdownDone:
		t.Fatal("theme shutdown returned before the active database read completed")
	case <-time.After(50 * time.Millisecond):
	}
}

func assertThemeShutdownCompleted(t *testing.T, shutdownDone <-chan struct{}) {
	t.Helper()
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("theme shutdown did not finish after the database read completed")
	}
}

func assertThemeServiceStopped(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	assert.ErrorContains(t, err, "theme service is shutting down")
}
