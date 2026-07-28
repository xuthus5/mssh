package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAppShutdownWaitsForSerialServiceBeforeClosingDatabase(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	serialService := service.NewSerialService(database, DefaultTestLogger(t))
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	operationDone := make(chan error, 1)
	go func() {
		_, listErr := serialService.List()
		operationDone <- listErr
	}()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, Serial: serialService, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()
	assertShutdownPending(t, shutdownDone, "active serial database operation")
	rollback()
	require.NoError(t, <-operationDone)
	assertShutdownCompleted(t, shutdownDone, "serial database operation")
	assert.Error(t, database.Ping())
	_, err = serialService.List()
	require.ErrorContains(t, err, "serial service is shutting down")
}
