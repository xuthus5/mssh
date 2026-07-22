package service

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestLogService_ListBySessionNoMatch(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-nomatch", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	_, err = svc.StartTerminalRecording("term-nomatch", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)
	t.Cleanup(func() { _ = svc.StopTerminalRecordingIfActive("term-nomatch") })

	otherID := int64(999)
	logs, err := svc.List(&otherID)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestLogService_DeleteNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	err := svc.Delete(999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "delete")
}

func TestLogService_StopTerminalRecordingTwice(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-stoptwice", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	_, err = svc.StartTerminalRecording("term-stop-twice", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)

	err = svc.StopTerminalRecording("term-stop-twice")
	require.NoError(t, err)

	err = svc.StopTerminalRecording("term-stop-twice")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")
}

func TestLogService_StartTerminalRecordingClosedDB(t *testing.T) {
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	svc := NewLogService(db, dataDir, testutil.NewTestLogger())

	require.NoError(t, db.Close())
	_, err := svc.StartTerminalRecording("term-closed-db", 1, 80, 24, "xterm")
	assert.Error(t, err)
	files, readErr := os.ReadDir(filepath.Join(dataDir, "recordings"))
	require.NoError(t, readErr)
	assert.Empty(t, files)
	assert.Empty(t, svc.recorders)
}

func TestLogService_StartTerminalRecordingCombinesCleanupErrors(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	createErr := errors.New("create log failed")
	closeErr := errors.New("close cleanup failed")
	removeErr := errors.New("remove cleanup failed")
	recorder := &fakeTerminalRecorder{closeErr: closeErr}
	svc.newRecorder = func(string, int, int, string) (terminalRecorder, error) {
		return recorder, nil
	}
	svc.createSessionLog = func(*sql.DB, model.SessionLog) (*model.SessionLog, error) {
		return nil, createErr
	}
	svc.removeFile = func(string) error { return removeErr }

	_, err := svc.StartTerminalRecording("term-cleanup-errors", 1, 80, 24, "xterm")

	assert.ErrorIs(t, err, createErr)
	assert.ErrorIs(t, err, closeErr)
	assert.ErrorIs(t, err, removeErr)
	assert.True(t, recorder.closed)
	assert.Empty(t, svc.recorders)
}

func TestLogService_DeleteWithDataPath(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-del-path", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	logID, err := svc.StartTerminalRecording("term-delete-path", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)
	logs, err := svc.List(nil)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	dataPath := logs[0].DataPath
	require.NoError(t, svc.StopTerminalRecording("term-delete-path"))

	err = svc.Delete(logID)
	require.NoError(t, err)
	_, err = os.Stat(dataPath)
	assert.True(t, os.IsNotExist(err))

	logs, err = svc.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestLogService_StartTerminalRecording(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-term-rec", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	logID, err := svc.StartTerminalRecording("term-test-1", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)
	assert.NotZero(t, logID)

	err = svc.StopTerminalRecording("term-test-1")
	require.NoError(t, err)

	err = svc.StopTerminalRecording("term-test-1")
	assert.Error(t, err)
}

func TestLogService_StopTerminalRecordingNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	err := svc.StopTerminalRecording("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")
}

func TestLogService_StopTerminalRecordingIfActive(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	created, err := sessionSvc.CreateSession(model.SessionInput{
		Name: "conditional-stop", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	logID, err := svc.StartTerminalRecording("term-conditional", created.ID, 80, 24, "xterm")
	require.NoError(t, err)
	require.NoError(t, svc.StopTerminalRecordingIfActive("term-conditional"))
	logEntry, err := store.GetSessionLog(db, logID)
	require.NoError(t, err)
	assert.NotNil(t, logEntry.EndedAt)
	require.NoError(t, svc.StopTerminalRecordingIfActive("term-conditional"))
}

func TestCloseAllActiveRecordingsEndsLogsAndStopsFutureStarts(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	first := createLogTestSession(t, db, "shutdown-first")
	second := createLogTestSession(t, db, "shutdown-second")
	firstLogID, err := svc.StartTerminalRecording("term-shutdown-1", first.ID, 80, 24, "xterm")
	require.NoError(t, err)
	secondLogID, err := svc.StartTerminalRecording("term-shutdown-2", second.ID, 80, 24, "xterm")
	require.NoError(t, err)

	require.NoError(t, CloseAllActiveRecordings(svc))

	assert.Empty(t, svc.recorders)
	for _, logID := range []int64{firstLogID, secondLogID} {
		logEntry, getErr := store.GetSessionLog(db, logID)
		require.NoError(t, getErr)
		assert.NotNil(t, logEntry.EndedAt)
	}
	_, err = svc.StartTerminalRecording("term-after-shutdown", first.ID, 80, 24, "xterm")
	assert.ErrorContains(t, err, "shutting down")
}

func TestCloseAllActiveRecordingsWaitsForConcurrentStopFinalizer(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	session := createLogTestSession(t, db, "concurrent-finalizer")
	logID, err := svc.StartTerminalRecording("term-finalizer", session.ID, 80, 24, "xterm")
	require.NoError(t, err)
	finalizerStarted := make(chan struct{})
	releaseFinalizer := make(chan struct{})
	svc.endSessionLog = func(db *sql.DB, logID int64) error {
		close(finalizerStarted)
		<-releaseFinalizer
		return store.EndSessionLog(db, logID)
	}
	stopDone := make(chan error, 1)
	go func() { stopDone <- svc.StopTerminalRecording("term-finalizer") }()
	<-finalizerStarted
	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- CloseAllActiveRecordings(svc) }()

	select {
	case err = <-shutdownDone:
		t.Fatalf("shutdown returned before stop finalizer completed: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseFinalizer)
	require.NoError(t, <-stopDone)
	require.NoError(t, <-shutdownDone)
	logEntry, err := store.GetSessionLog(db, logID)
	require.NoError(t, err)
	assert.NotNil(t, logEntry.EndedAt)
}
