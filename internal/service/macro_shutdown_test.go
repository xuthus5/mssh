package service

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type blockingMacroTerminalWriter struct {
	started     chan struct{}
	closed      chan struct{}
	release     chan struct{}
	startedOnce sync.Once
	closeOnce   sync.Once
	closeCalls  atomic.Int32
}

func newBlockingMacroTerminalWriter() *blockingMacroTerminalWriter {
	return &blockingMacroTerminalWriter{
		started: make(chan struct{}), closed: make(chan struct{}), release: make(chan struct{}),
	}
}

func (writer *blockingMacroTerminalWriter) Write(_ string, _ string) (int, error) {
	writer.startedOnce.Do(func() { close(writer.started) })
	<-writer.closed
	<-writer.release
	return 0, errors.New("terminal closed")
}

func (writer *blockingMacroTerminalWriter) Close(string) error {
	writer.closeCalls.Add(1)
	writer.closeOnce.Do(func() { close(writer.closed) })
	return nil
}

func TestMacroServiceShutdownCancelsWaitsAndFinalizesAudit(t *testing.T) {
	database := testutil.NewTestDB(t)
	require.NoError(t, store.SetAuditEnabled(database, true))
	terminal := newBlockingMacroTerminalWriter()
	service := NewMacroService(database, nil, testutil.NewTestLogger())
	service.terminals = terminal

	executeDone := make(chan error, 1)
	go func() { executeDone <- service.Execute("term-1", "printf ready\n") }()
	<-terminal.started
	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-terminal.closed:
	case <-time.After(time.Second):
		t.Fatal("macro shutdown did not cancel the active terminal write")
	}
	select {
	case <-shutdownDone:
		t.Fatal("macro shutdown returned before the terminal write completed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, database.Ping())

	close(terminal.release)
	require.ErrorContains(t, <-executeDone, "terminal write canceled")
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("macro shutdown did not finish after terminal write completion")
	}
	events, err := store.ListAuditEvents(database, model.AuditFilter{Action: "macro_execute", Limit: 10})
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, "failed", events[0].Outcome)
	assert.Equal(t, int32(1), terminal.closeCalls.Load())
}

func TestMacroServiceRejectsAllOperationsAfterShutdown(t *testing.T) {
	service := NewMacroService(testutil.NewTestDB(t), nil, testutil.NewTestLogger())
	service.Shutdown()

	_, err := service.List()
	require.ErrorContains(t, err, "macro service is shutting down")
	_, err = service.Create(model.MacroInput{Name: "macro", Command: "echo"})
	require.ErrorContains(t, err, "macro service is shutting down")
	err = service.Update(model.MacroInput{ID: 1, Name: "macro", Command: "echo"})
	require.ErrorContains(t, err, "macro service is shutting down")
	err = service.Delete(1)
	require.ErrorContains(t, err, "macro service is shutting down")
	err = service.Execute("term-1", "echo")
	require.ErrorContains(t, err, "macro service is shutting down")
	service.Shutdown()
}

func TestNilMacroServiceShutdown(t *testing.T) {
	var service *MacroService
	assert.NotPanics(t, service.Shutdown)
	_, err := service.List()
	require.ErrorContains(t, err, "macro service is shutting down")
}
