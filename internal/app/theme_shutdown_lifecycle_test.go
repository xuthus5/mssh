package app

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAppShutdownWaitsForThemeBeforeClosingDatabase(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	themeService := service.NewThemeService(database, DefaultTestLogger(t))
	require.NoError(t, themeService.InitializeDefaults())
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	listDone := make(chan error, 1)
	go func() {
		_, listErr := themeService.ListDefinitions("")
		listDone <- listErr
	}()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, Theme: themeService, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("app shutdown returned before the active theme operation completed")
	case <-time.After(50 * time.Millisecond):
	}
	rollback()
	require.NoError(t, <-listDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("app shutdown did not finish after the theme operation completed")
	}
	assert.Error(t, database.Ping())
	_, err = themeService.ListDefinitions("")
	require.ErrorContains(t, err, "theme service is shutting down")
}
