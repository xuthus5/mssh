package service

import (
	"database/sql"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestLogStopOperationsWaitsForActiveList(t *testing.T) {
	database := testutil.NewTestDB(t)
	logService := NewLogService(database, t.TempDir(), testutil.NewTestLogger())
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	operationDone := make(chan error, 1)
	go func() {
		_, err := logService.List(nil)
		operationDone <- err
	}()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	shutdownDone := make(chan struct{})
	go func() {
		logService.StopOperationsAndWait()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("log operations stopped before the active list completed")
	case <-time.After(50 * time.Millisecond):
	}
	rollback()
	require.NoError(t, <-operationDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("log operations did not stop after the active list completed")
	}
	require.NoError(t, database.Ping())
}

func TestLogShutdownRejectsPublicOperations(t *testing.T) {
	logService := NewLogService(testutil.NewTestDB(t), t.TempDir(), testutil.NewTestLogger())
	require.NoError(t, logService.Shutdown())
	require.NoError(t, logService.Shutdown())

	_, err := logService.List(nil)
	assertLogStopped(t, err)
	_, err = logService.StartTerminalRecording("term-1", 0, 80, 24, "xterm")
	assertLogStopped(t, err)
	assertLogStopped(t, logService.StopTerminalRecording("term-1"))
	assertLogStopped(t, logService.Delete(1))
	_, err = logService.GetRecording("/tmp/recording.msshlog")
	assertLogStopped(t, err)
}

func TestLogShutdownHandlesNilReceiver(t *testing.T) {
	var logService *LogService
	assert.NotPanics(t, logService.StopOperationsAndWait)
	require.NoError(t, logService.Shutdown())
	_, err := logService.List(nil)
	assertLogStopped(t, err)
}

func TestLogStopOperationsKeepsInternalOutputAndCloseActive(t *testing.T) {
	recorder := &countingTerminalRecorder{}
	logService := NewLogService(nil, t.TempDir(), testutil.NewTestLogger())
	logService.newRecorder = func(string, int, int, string) (terminalRecorder, error) {
		return recorder, nil
	}
	logService.createSessionLog = func(_ *sql.DB, entry model.SessionLog) (*model.SessionLog, error) {
		entry.ID = 1
		return &entry, nil
	}
	logService.endSessionLog = func(*sql.DB, int64) error { return nil }
	_, err := logService.StartTerminalRecording("term-1", 0, 80, 24, "xterm")
	require.NoError(t, err)

	logService.StopOperationsAndWait()
	logService.HandleOutput("term-1", []byte("tail output"))
	require.NoError(t, logService.StopTerminalRecordingIfActive("term-1"))
	require.NoError(t, logService.Shutdown())
	assert.Equal(t, 1, recorder.writeCount())
	assert.True(t, recorder.isClosed())
}

func TestLogDeleteRejectsActiveAndFinalizingRecording(t *testing.T) {
	database := testutil.NewTestDB(t)
	logService := NewLogService(database, t.TempDir(), testutil.NewTestLogger())
	activeID, err := logService.StartTerminalRecording("term-active", 0, 80, 24, "xterm")
	require.NoError(t, err)
	err = logService.Delete(activeID)
	require.Error(t, err)
	assert.ErrorContains(t, err, "in use")
	require.NoError(t, logService.StopTerminalRecording("term-active"))

	finalizerStarted := make(chan struct{})
	releaseFinalizer := make(chan struct{})
	logService.endSessionLog = func(database *sql.DB, logID int64) error {
		close(finalizerStarted)
		<-releaseFinalizer
		return store.EndSessionLog(database, logID)
	}
	finalizingID, err := logService.StartTerminalRecording("term-finalizing", 0, 80, 24, "xterm")
	require.NoError(t, err)
	stopDone := make(chan error, 1)
	go func() { stopDone <- logService.StopTerminalRecording("term-finalizing") }()
	<-finalizerStarted
	err = logService.Delete(finalizingID)
	require.Error(t, err)
	assert.ErrorContains(t, err, "in use")
	close(releaseFinalizer)
	require.NoError(t, <-stopDone)
}

func assertLogStopped(t *testing.T, err error) {
	t.Helper()
	assertServiceStoppedError(t, err, "log service is shutting down")
}

type countingTerminalRecorder struct {
	mu     sync.Mutex
	writes int
	closed bool
}

func (recorder *countingTerminalRecorder) Write([]byte, model.RecordType) error {
	recorder.mu.Lock()
	recorder.writes++
	recorder.mu.Unlock()
	return nil
}

func (recorder *countingTerminalRecorder) Close() error {
	recorder.mu.Lock()
	recorder.closed = true
	recorder.mu.Unlock()
	return nil
}

func (recorder *countingTerminalRecorder) writeCount() int {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	return recorder.writes
}

func (recorder *countingTerminalRecorder) isClosed() bool {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	return recorder.closed
}
