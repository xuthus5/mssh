package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAppShutdownWaitsForAuxiliaryDataServicesBeforeClosingDatabase(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	history := service.NewCommandHistoryService(database, DefaultTestLogger(t))
	audit := service.NewAuditService(database, DefaultTestLogger(t))
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	historyDone := make(chan error, 1)
	auditDone := make(chan error, 1)
	go func() { _, listErr := history.List(1, ""); historyDone <- listErr }()
	go func() { _, enabledErr := audit.Enabled(); auditDone <- enabledErr }()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+2)

	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, CommandHistory: history, Audit: audit, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()
	assertShutdownPending(t, shutdownDone, "auxiliary data operations")
	rollback()
	require.NoError(t, <-historyDone)
	require.NoError(t, <-auditDone)
	assertShutdownCompleted(t, shutdownDone, "auxiliary data operations")
	assert.Error(t, database.Ping())
	_, err = history.List(1, "")
	require.ErrorContains(t, err, "command history service is shutting down")
	_, err = audit.Enabled()
	require.ErrorContains(t, err, "audit service is shutting down")
}
