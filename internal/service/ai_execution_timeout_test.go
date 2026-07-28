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

type abortableTerminalWriter struct {
	release   chan struct{}
	closeOnce sync.Once
	closed    atomic.Bool
	writes    atomic.Int32
	sessionID int64
	writeErr  error
	closeErr  error
}

type nonInterruptingTerminalWriter struct {
	release      chan struct{}
	closeRelease chan struct{}
	closed       atomic.Bool
}

func newAbortableTerminalWriter(sessionID int64, writeErr, closeErr error) *abortableTerminalWriter {
	return &abortableTerminalWriter{
		release:   make(chan struct{}),
		sessionID: sessionID,
		writeErr:  writeErr,
		closeErr:  closeErr,
	}
}

func (w *abortableTerminalWriter) Write(_ string, data string) (int, error) {
	<-w.release
	if w.writeErr != nil {
		return 0, w.writeErr
	}
	w.writes.Add(1)
	return len(data), nil
}

func (w *abortableTerminalWriter) Close(string) error {
	w.closed.Store(true)
	w.closeOnce.Do(func() { close(w.release) })
	return w.closeErr
}

func (w *abortableTerminalWriter) SystemInfo(string) (*model.SystemInfo, error) {
	return &model.SystemInfo{}, nil
}

func (w *abortableTerminalWriter) terminalSessionID(string) (int64, bool) {
	return w.sessionID, w.sessionID > 0
}

func (w *nonInterruptingTerminalWriter) Write(_ string, data string) (int, error) {
	<-w.release
	return len(data), nil
}

func (w *nonInterruptingTerminalWriter) Close(string) error {
	w.closed.Store(true)
	if w.closeRelease != nil {
		<-w.closeRelease
	}
	return nil
}

func (w *nonInterruptingTerminalWriter) SystemInfo(string) (*model.SystemInfo, error) {
	return &model.SystemInfo{}, nil
}

func (w *nonInterruptingTerminalWriter) terminalSessionID(string) (int64, bool) {
	return 0, false
}

func TestAIServiceExecuteCommandWriteTimeout(t *testing.T) {
	db := testutil.NewTestDB(t)
	session := createAIServiceSession(t, db)
	terminal := newAbortableTerminalWriter(session.ID, errors.New("terminal closed"), nil)
	t.Cleanup(func() { _ = terminal.Close("term") })
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	service.terminals = terminal
	settings := defaultAISettings()
	settings.Security.CommandTimeoutSeconds = 1
	require.NoError(t, store.SaveAISettings(db, settings))
	require.NoError(t, store.SetAuditEnabled(db, true))

	err := service.ExecuteCommand(model.AICommandExecutionInput{
		SessionID: session.ID, TerminalID: "term", Command: "echo late", Approved: true,
	})
	require.ErrorContains(t, err, "timed out")
	assert.True(t, terminal.closed.Load())
	assert.Zero(t, terminal.writes.Load())
	events, listErr := store.ListAuditEvents(db, model.AuditFilter{Action: "ai_command_failed", Limit: 10})
	require.NoError(t, listErr)
	require.Len(t, events, 1)
	assert.Equal(t, "failed", events[0].Outcome)
}

func TestTerminalWriteTimeoutAbortsBeforeReturning(t *testing.T) {
	terminal := newAbortableTerminalWriter(0, errors.New("terminal closed"), nil)
	t.Cleanup(func() { _ = terminal.Close("term") })
	err := writeTerminalWithTimeout(terminal, "term", "echo late\n", 20*time.Millisecond)
	require.ErrorContains(t, err, "timed out")
	assert.True(t, terminal.closed.Load())
	assert.Zero(t, terminal.writes.Load())
}

func TestTerminalWriteTimeoutReportsCloseFailure(t *testing.T) {
	terminal := newAbortableTerminalWriter(0, errors.New("terminal closed"), errors.New("close failed"))
	t.Cleanup(func() { _ = terminal.Close("term") })
	err := writeTerminalWithTimeout(terminal, "term", "echo late\n", 20*time.Millisecond)
	require.ErrorContains(t, err, "close terminal after write timeout: close failed")
	assert.ErrorContains(t, err, "terminal write ended after timeout: terminal closed")
}

func TestTerminalWriteTimeoutReportsUnknownLateSuccess(t *testing.T) {
	terminal := newAbortableTerminalWriter(0, nil, nil)
	t.Cleanup(func() { _ = terminal.Close("term") })
	err := writeTerminalWithTimeout(terminal, "term", "echo late\n", 20*time.Millisecond)
	require.ErrorContains(t, err, "command outcome is unknown")
	assert.True(t, terminal.closed.Load())
	assert.Equal(t, int32(1), terminal.writes.Load())
}

func TestTerminalWriteTimeoutReturnsWhenCloseCannotStopWrite(t *testing.T) {
	originalAbortWait := terminalWriteAbortWait
	terminalWriteAbortWait = 20 * time.Millisecond
	t.Cleanup(func() { terminalWriteAbortWait = originalAbortWait })
	terminal := &nonInterruptingTerminalWriter{release: make(chan struct{})}
	result := make(chan error, 1)
	go func() {
		result <- writeTerminalWithTimeout(terminal, "term", "echo late\n", 10*time.Millisecond)
	}()

	select {
	case err := <-result:
		require.ErrorContains(t, err, "terminal write did not stop")
		assert.True(t, terminal.closed.Load())
	case <-time.After(300 * time.Millisecond):
		close(terminal.release)
		<-result
		t.Fatal("terminal write timeout remained blocked after close returned")
	}
	close(terminal.release)
}

func TestTerminalWriteTimeoutReturnsWhenCloseItselfBlocks(t *testing.T) {
	originalAbortWait := terminalWriteAbortWait
	terminalWriteAbortWait = 20 * time.Millisecond
	t.Cleanup(func() { terminalWriteAbortWait = originalAbortWait })
	terminal := &nonInterruptingTerminalWriter{
		release: make(chan struct{}), closeRelease: make(chan struct{}),
	}
	result := make(chan error, 1)
	go func() {
		result <- writeTerminalWithTimeout(terminal, "term", "echo late\n", 10*time.Millisecond)
	}()

	select {
	case err := <-result:
		require.ErrorContains(t, err, "terminal close did not finish")
		require.ErrorContains(t, err, "terminal write did not stop")
	case <-time.After(300 * time.Millisecond):
		close(terminal.closeRelease)
		close(terminal.release)
		<-result
		t.Fatal("terminal write timeout remained blocked in close")
	}
	close(terminal.closeRelease)
	close(terminal.release)
}

func TestMacroServiceExecuteTimeoutClosesTerminal(t *testing.T) {
	db := testutil.NewTestDB(t)
	terminal := newAbortableTerminalWriter(0, errors.New("terminal closed"), nil)
	t.Cleanup(func() { _ = terminal.Close("term") })
	service := NewMacroService(db, nil, testutil.NewTestLogger())
	service.terminals = terminal
	settings := defaultAISettings()
	settings.Security.CommandTimeoutSeconds = 1
	require.NoError(t, store.SaveAISettings(db, settings))
	require.NoError(t, store.SetAuditEnabled(db, true))

	err := service.Execute("term", "echo late\n")
	require.ErrorContains(t, err, "timed out")
	assert.True(t, terminal.closed.Load())
	assert.Zero(t, terminal.writes.Load())
	events, listErr := store.ListAuditEvents(db, model.AuditFilter{Action: "macro_execute", Limit: 10})
	require.NoError(t, listErr)
	require.Len(t, events, 1)
	assert.Equal(t, "failed", events[0].Outcome)
}
