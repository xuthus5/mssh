package service

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestCloseAllActiveRecordingsConcurrentCallsShareCompletion(t *testing.T) {
	finalizeErr := errors.New("finalize failed")
	finalizerStarted := make(chan struct{})
	releaseFinalizer := make(chan struct{})
	service := NewLogService(nil, t.TempDir(), testutil.NewTestLogger())
	service.recorders["term-shutdown"] = &activeRecording{
		recorder: &fakeTerminalRecorder{},
		logID:    1,
	}
	service.endSessionLog = func(_ *sql.DB, _ int64) error {
		close(finalizerStarted)
		<-releaseFinalizer
		return finalizeErr
	}

	firstDone := make(chan error, 1)
	go func() { firstDone <- CloseAllActiveRecordings(service) }()
	<-finalizerStarted
	secondDone := make(chan error, 1)
	go func() { secondDone <- CloseAllActiveRecordings(service) }()

	assertShutdownStillWaiting(t, secondDone)
	close(releaseFinalizer)
	firstErr := <-firstDone
	secondErr := <-secondDone
	repeatedErr := CloseAllActiveRecordings(service)

	for _, err := range []error{firstErr, secondErr, repeatedErr} {
		require.ErrorIs(t, err, finalizeErr)
	}
	assert.EqualError(t, secondErr, firstErr.Error())
	assert.EqualError(t, repeatedErr, firstErr.Error())
}

func TestCloseAllActiveRecordingsRejectsStartsDuringAndAfterShutdown(t *testing.T) {
	finalizerStarted := make(chan struct{})
	releaseFinalizer := make(chan struct{})
	service := NewLogService(nil, t.TempDir(), testutil.NewTestLogger())
	service.recorders["term-shutdown"] = &activeRecording{
		recorder: &fakeTerminalRecorder{},
		logID:    1,
	}
	service.endSessionLog = func(_ *sql.DB, _ int64) error {
		close(finalizerStarted)
		<-releaseFinalizer
		return nil
	}

	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- CloseAllActiveRecordings(service) }()
	<-finalizerStarted
	_, duringErr := service.StartTerminalRecording("during", 1, 80, 24, "xterm")
	close(releaseFinalizer)
	require.NoError(t, <-shutdownDone)
	_, afterErr := service.StartTerminalRecording("after", 1, 80, 24, "xterm")

	assert.ErrorContains(t, duringErr, "shutting down")
	assert.ErrorContains(t, afterErr, "shutting down")
}

func TestCloseAllActiveRecordingsCoordinatesInFlightStartWithoutHoldingServiceLock(t *testing.T) {
	createStarted := make(chan struct{})
	releaseCreate := make(chan struct{})
	service := NewLogService(nil, t.TempDir(), testutil.NewTestLogger())
	service.newRecorder = func(string, int, int, string) (terminalRecorder, error) {
		return &fakeTerminalRecorder{}, nil
	}
	service.createSessionLog = func(_ *sql.DB, log model.SessionLog) (*model.SessionLog, error) {
		close(createStarted)
		<-releaseCreate
		log.ID = 1
		return &log, nil
	}
	service.endSessionLog = func(_ *sql.DB, _ int64) error { return nil }

	startDone := make(chan error, 1)
	go func() {
		_, err := service.StartTerminalRecording("in-flight", 1, 80, 24, "xterm")
		startDone <- err
	}()
	<-createStarted
	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- CloseAllActiveRecordings(service) }()

	if !waitForShutdownState(service, 100*time.Millisecond) {
		close(releaseCreate)
		<-startDone
		<-shutdownDone
		t.Fatal("shutdown could not acquire the service lock during database I/O")
	}
	_, rejectedErr := service.StartTerminalRecording("after-start", 1, 80, 24, "xterm")
	close(releaseCreate)

	assert.ErrorContains(t, rejectedErr, "shutting down")
	assert.ErrorContains(t, <-startDone, "shutting down")
	require.NoError(t, <-shutdownDone)
}

func TestCloseAllActiveRecordingsSharesConcurrentStopFinalizerError(t *testing.T) {
	finalizeErr := errors.New("stop finalize failed")
	finalizerStarted := make(chan struct{})
	releaseFinalizer := make(chan struct{})
	service := NewLogService(nil, t.TempDir(), testutil.NewTestLogger())
	service.recorders["term-stop"] = &activeRecording{
		recorder: &fakeTerminalRecorder{},
		logID:    1,
	}
	service.endSessionLog = func(_ *sql.DB, _ int64) error {
		close(finalizerStarted)
		<-releaseFinalizer
		return finalizeErr
	}

	stopDone := make(chan error, 1)
	go func() { stopDone <- service.StopTerminalRecording("term-stop") }()
	<-finalizerStarted
	firstDone := make(chan error, 1)
	secondDone := make(chan error, 1)
	go func() { firstDone <- CloseAllActiveRecordings(service) }()
	go func() { secondDone <- CloseAllActiveRecordings(service) }()

	assertShutdownStillWaiting(t, secondDone)
	close(releaseFinalizer)
	stopErr := <-stopDone
	firstErr := <-firstDone
	secondErr := <-secondDone

	require.ErrorIs(t, stopErr, finalizeErr)
	require.ErrorIs(t, firstErr, finalizeErr)
	require.ErrorIs(t, secondErr, finalizeErr)
	assert.EqualError(t, secondErr, firstErr.Error())
}

func assertShutdownStillWaiting(t *testing.T, shutdownDone <-chan error) {
	t.Helper()
	select {
	case err := <-shutdownDone:
		t.Fatalf("shutdown returned before first finalization completed: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
}

func waitForShutdownState(service *LogService, timeout time.Duration) bool {
	shutdownStarted := make(chan struct{})
	go func() {
		for {
			service.mu.Lock()
			shuttingDown := service.shuttingDown
			service.mu.Unlock()
			if shuttingDown {
				close(shutdownStarted)
				return
			}
			time.Sleep(time.Millisecond)
		}
	}()
	select {
	case <-shutdownStarted:
		return true
	case <-time.After(timeout):
		return false
	}
}
