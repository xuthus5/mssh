package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

type sessionFolderListResult struct {
	folders []model.SessionFolder
	err     error
}

type sessionStoppedCheck struct {
	name string
	run  func() error
}

func TestSessionShutdownWaitsForActiveDatabaseOperation(t *testing.T) {
	database := testutil.NewTestDB(t)
	sessionService := NewSessionService(database, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	listDone := make(chan sessionFolderListResult, 1)
	go func() {
		folders, err := sessionService.ListFolders()
		listDone <- sessionFolderListResult{folders: folders, err: err}
	}()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- sessionService.Shutdown() }()
	select {
	case err := <-shutdownDone:
		require.NoError(t, err)
		t.Fatal("session shutdown returned before the active database operation completed")
	case <-time.After(50 * time.Millisecond):
	}
	rollback()
	result := <-listDone
	require.NoError(t, result.err)
	assert.NotNil(t, result.folders)
	select {
	case err := <-shutdownDone:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("session shutdown did not finish after the database operation completed")
	}
	require.NoError(t, database.Ping())
}

func TestSessionShutdownRejectsBusinessOperations(t *testing.T) {
	sessionService := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	require.NoError(t, sessionService.Shutdown())
	checks := append(sessionCRUDStoppedChecks(sessionService), sessionIOStoppedChecks(sessionService)...)
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			assertSessionServiceStopped(t, check.run())
		})
	}
}

func TestSessionOperationGateHandlesNilReceiver(t *testing.T) {
	var sessionService *SessionService
	assert.NotPanics(t, sessionService.StopOperationsAndWait)
	assert.Equal(t, 0, sessionService.ConnectionCount())
	_, err := sessionService.ListFolders()
	assertSessionServiceStopped(t, err)
}

func TestSessionStopOperationsRejectsConnectAttemptAfterCancellationSweep(t *testing.T) {
	sessionService := NewSessionService(nil, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	operationDone, err := sessionService.beginOperation()
	require.NoError(t, err)

	attemptCanceled := make(chan struct{})
	sessionService.mu.Lock()
	sessionService.attempts["existing"] = &connectAttempt{cancel: func() { close(attemptCanceled) }}
	sessionService.mu.Unlock()

	stopDone := make(chan struct{})
	go func() {
		sessionService.StopOperationsAndWait()
		close(stopDone)
	}()

	select {
	case <-attemptCanceled:
	case <-time.After(time.Second):
		operationDone()
		t.Fatal("session stop did not finish the connection-attempt cancellation sweep")
	}

	_, attemptID, _, finishConnect, connectErr := sessionService.beginConnect(context.Background(), 42)
	sessionService.mu.RLock()
	_, registered := sessionService.attempts[attemptID]
	sessionService.mu.RUnlock()
	if finishConnect != nil {
		finishConnect()
	}
	operationDone()

	select {
	case <-stopDone:
	case <-time.After(time.Second):
		t.Fatal("session stop did not finish after the active operation completed")
	}
	require.Error(t, connectErr)
	assert.ErrorContains(t, connectErr, "session service is shutting down")
	assert.False(t, registered)
}

func sessionCRUDStoppedChecks(sessionService *SessionService) []sessionStoppedCheck {
	return []sessionStoppedCheck{
		{name: "list folders", run: func() error { _, err := sessionService.ListFolders(); return err }},
		{name: "create folder", run: func() error { _, err := sessionService.CreateFolder("", nil); return err }},
		{name: "update folder", run: func() error { return sessionService.UpdateFolder(0, "") }},
		{name: "delete folder", run: func() error { return sessionService.DeleteFolder(0) }},
		{name: "set default folder", run: func() error { return sessionService.SetDefaultFolder(0) }},
		{name: "move folder", run: func() error { return sessionService.MoveFolder(0, nil) }},
		{name: "list sessions", run: func() error { _, err := sessionService.ListSessions(nil); return err }},
		{name: "list recent sessions", run: func() error { _, err := sessionService.ListRecentSessions(1); return err }},
		{name: "create session", run: func() error { _, err := sessionService.CreateSession(model.SessionInput{}); return err }},
		{name: "update session", run: func() error { return sessionService.UpdateSession(model.SessionInput{}) }},
		{name: "move session", run: func() error { return sessionService.MoveSession(0, nil) }},
		{name: "get session", run: func() error { _, err := sessionService.GetSession(0); return err }},
		{name: "delete session", run: func() error { return sessionService.DeleteSession(0) }},
		{name: "delete sessions", run: func() error { _, err := sessionService.DeleteSessions(nil); return err }},
		{name: "sessions delete impact", run: func() error { _, err := sessionService.SessionsDeleteImpact(nil); return err }},
		{name: "session delete impact", run: func() error { _, err := sessionService.SessionDeleteImpact(0); return err }},
	}
}

func sessionIOStoppedChecks(sessionService *SessionService) []sessionStoppedCheck {
	return []sessionStoppedCheck{
		{name: "export csv", run: func() error { _, err := sessionService.ExportCSV("", model.SessionCSVExportOptions{}); return err }},
		{name: "import csv", run: func() error { _, err := sessionService.ImportCSV("", model.SessionCSVImportOptions{}); return err }},
		{name: "preview csv", run: func() error { _, err := sessionService.PreviewCSV(""); return err }},
		{name: "list host keys", run: func() error { _, err := sessionService.ListHostKeys(); return err }},
		{name: "delete host key", run: func() error { return sessionService.DeleteHostKey(0) }},
		{name: "decide host key", run: func() error { return sessionService.DecideHostKey("", false) }},
		{name: "cancel connect", run: func() error { return sessionService.CancelConnect("") }},
		{name: "connect", run: func() error { _, err := sessionService.connect(context.Background(), 0, false); return err }},
		{name: "get client wrapper", run: func() error { _, err := sessionService.GetClientWrapper(""); return err }},
		{name: "close all", run: sessionService.CloseAll},
	}
}

func assertSessionServiceStopped(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	assert.ErrorContains(t, err, "session service is shutting down")
}
