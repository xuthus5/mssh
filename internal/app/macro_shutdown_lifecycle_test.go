package app

import (
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
)

type blockingMacroLogWriter struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (writer *blockingMacroLogWriter) Write(payload []byte) (int, error) {
	writer.once.Do(func() { close(writer.started) })
	<-writer.release
	return len(payload), nil
}

func TestAppShutdownStopsMacroServiceBeforeClosingDatabase(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	logWriter := &blockingMacroLogWriter{started: make(chan struct{}), release: make(chan struct{})}
	var releaseOnce sync.Once
	releaseLog := func() { releaseOnce.Do(func() { close(logWriter.release) }) }
	t.Cleanup(releaseLog)
	macroLogger := slog.New(slog.NewTextHandler(logWriter, nil))
	macroService := service.NewMacroService(database, nil, macroLogger)

	createDone := make(chan error, 1)
	go func() {
		_, createErr := macroService.Create(model.MacroInput{Name: "shutdown", Command: "printf ready"})
		createDone <- createErr
	}()
	<-logWriter.started
	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, Macro: macroService, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("app shutdown returned before the active macro operation completed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, database.Ping())

	releaseLog()
	require.NoError(t, <-createDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("app shutdown did not finish after the macro operation completed")
	}
	assert.Error(t, database.Ping())
	_, err = macroService.List()
	require.ErrorContains(t, err, "macro service is shutting down")
}
