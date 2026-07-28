package app

import (
	"database/sql"
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAppShutdownClosesTerminalBeforeFinalizingItsRecording(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("local shell lifecycle is covered by the Windows conpty integration suite")
	}
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	finalizerStarted := make(chan struct{})
	releaseFinalizer := make(chan struct{})
	logService := service.NewLogService(
		database,
		t.TempDir(),
		DefaultTestLogger(t),
		service.WithSessionLogFinalizer(func(database *sql.DB, logID int64) error {
			close(finalizerStarted)
			<-releaseFinalizer
			return store.EndSessionLog(database, logID)
		}),
	)
	terminalService := service.NewTerminalService(nil, discardEventBus{}, 4, DefaultTestLogger(t))
	configureTerminalLogging(terminalService, logService, DefaultTestLogger(t))
	terminalID, err := terminalService.OpenLocal(t.Context(), 80, 24)
	require.NoError(t, err)
	_, err = logService.StartTerminalRecording(terminalID, 0, 80, 24, "xterm")
	require.NoError(t, err)

	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, Log: logService, Terminal: terminalService, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-finalizerStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("recording finalizer did not start")
	}
	assert.Equal(t, 0, terminalService.Count())
	close(releaseFinalizer)
	assertShutdownCompleted(t, shutdownDone, "terminal recording finalization")
}
