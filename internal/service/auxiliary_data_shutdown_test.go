package service

import (
	"database/sql"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestCommandHistoryShutdownWaitsForActiveOperation(t *testing.T) {
	database := testutil.NewTestDB(t)
	history := NewCommandHistoryService(database, testutil.NewTestLogger())
	assertDatabaseServiceShutdownWaits(t, database, func() error {
		_, err := history.List(1, "")
		return err
	}, history.Shutdown)
}

func TestAuditShutdownWaitsForActiveOperation(t *testing.T) {
	database := testutil.NewTestDB(t)
	audit := NewAuditService(database, testutil.NewTestLogger())
	assertDatabaseServiceShutdownWaits(t, database, func() error {
		_, err := audit.Enabled()
		return err
	}, audit.Shutdown)
}

func TestAuxiliaryDataServicesRejectOperationsAfterShutdown(t *testing.T) {
	database := testutil.NewTestDB(t)
	history := NewCommandHistoryService(database, testutil.NewTestLogger())
	audit := NewAuditService(database, testutil.NewTestLogger())
	history.Shutdown()
	audit.Shutdown()

	assertCommandHistoryStopped(t, history)
	assertAuditStopped(t, audit)
}

func TestAuxiliaryDataShutdownHandlesNilReceivers(t *testing.T) {
	var history *CommandHistoryService
	var audit *AuditService
	assert.NotPanics(t, history.Shutdown)
	assert.NotPanics(t, audit.Shutdown)
	_, historyErr := history.List(1, "")
	_, auditErr := audit.Enabled()
	assertServiceStoppedError(t, historyErr, "command history service is shutting down")
	assertServiceStoppedError(t, auditErr, "audit service is shutting down")
}

func assertDatabaseServiceShutdownWaits(t *testing.T, database *sql.DB, operation func() error, shutdown func()) {
	t.Helper()
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	operationDone := make(chan error, 1)
	go func() { operationDone <- operation() }()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)
	shutdownDone := make(chan struct{})
	go func() {
		shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("service shutdown returned before the active database operation completed")
	case <-time.After(50 * time.Millisecond):
	}
	rollback()
	require.NoError(t, <-operationDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("service shutdown did not finish after the database operation completed")
	}
	require.NoError(t, database.Ping())
}

func assertCommandHistoryStopped(t *testing.T, history *CommandHistoryService) {
	t.Helper()
	_, err := history.Add(0, "")
	assertServiceStoppedError(t, err, "command history service is shutting down")
	_, err = history.List(0, "")
	assertServiceStoppedError(t, err, "command history service is shutting down")
	assertServiceStoppedError(t, history.Delete(0), "command history service is shutting down")
	assertServiceStoppedError(t, history.Clear(0), "command history service is shutting down")
}

func assertAuditStopped(t *testing.T, audit *AuditService) {
	t.Helper()
	_, err := audit.Enabled()
	assertServiceStoppedError(t, err, "audit service is shutting down")
	assertServiceStoppedError(t, audit.SetEnabled(false), "audit service is shutting down")
	_, err = audit.List(model.AuditFilter{})
	assertServiceStoppedError(t, err, "audit service is shutting down")
	assertServiceStoppedError(t, audit.RecordBatch("", nil, nil), "audit service is shutting down")
}

func assertServiceStoppedError(t *testing.T, err error, message string) {
	t.Helper()
	require.Error(t, err)
	assert.ErrorContains(t, err, message)
}
