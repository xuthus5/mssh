package service

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

type shutdownBlockingWriteTerminal struct {
	started   chan struct{}
	release   chan struct{}
	startOnce sync.Once
	closeOnce sync.Once
	closeErr  error
}

type shutdownRetryCloseTerminal struct {
	started     chan struct{}
	release     chan struct{}
	startOnce   sync.Once
	releaseOnce sync.Once
	mu          sync.Mutex
	closeCalls  int
	closeErr    error
}

func (terminal *shutdownRetryCloseTerminal) Write([]byte) (int, error) {
	terminal.startOnce.Do(func() { close(terminal.started) })
	<-terminal.release
	return 0, errors.New("terminal closed")
}

func (terminal *shutdownRetryCloseTerminal) Resize(int, int) error { return nil }

func (terminal *shutdownRetryCloseTerminal) Close() error {
	terminal.mu.Lock()
	terminal.closeCalls++
	call := terminal.closeCalls
	terminal.mu.Unlock()
	terminal.releaseOnce.Do(func() { close(terminal.release) })
	if call == 1 {
		return terminal.closeErr
	}
	return nil
}

func (terminal *shutdownRetryCloseTerminal) SetReadCallback(func([]byte)) {}

func (terminal *shutdownRetryCloseTerminal) SetExitCallback(func(error)) {}

func (terminal *shutdownRetryCloseTerminal) Start() {}

func (terminal *shutdownRetryCloseTerminal) CloseCount() int {
	terminal.mu.Lock()
	defer terminal.mu.Unlock()
	return terminal.closeCalls
}

func (terminal *shutdownBlockingWriteTerminal) Write([]byte) (int, error) {
	terminal.startOnce.Do(func() { close(terminal.started) })
	<-terminal.release
	return 0, errors.New("terminal closed")
}

func (terminal *shutdownBlockingWriteTerminal) Resize(int, int) error { return nil }

func (terminal *shutdownBlockingWriteTerminal) Close() error {
	terminal.closeOnce.Do(func() { close(terminal.release) })
	return terminal.closeErr
}

func (terminal *shutdownBlockingWriteTerminal) SetReadCallback(func([]byte)) {}

func (terminal *shutdownBlockingWriteTerminal) SetExitCallback(func(error)) {}

func (terminal *shutdownBlockingWriteTerminal) Start() {}

func TestTerminalServiceShutdownInterruptsBlockedWriteAndReportsCloseError(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 4, testutil.NewTestLogger())
	closeErr := errors.New("interrupt terminal close failed")
	terminal := &shutdownBlockingWriteTerminal{
		started: make(chan struct{}), release: make(chan struct{}), closeErr: closeErr,
	}
	t.Cleanup(func() { _ = terminal.Close() })
	service.ptys["term-1"] = terminal
	service.lastUsed["term-1"] = time.Now()

	writeDone := make(chan error, 1)
	go func() {
		_, err := service.Write("term-1", "payload")
		writeDone <- err
	}()
	<-terminal.started

	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- service.Shutdown() }()
	select {
	case err := <-shutdownDone:
		require.ErrorIs(t, err, closeErr)
	case <-time.After(time.Second):
		t.Fatal("terminal shutdown did not close the terminal to interrupt the blocked write")
	}
	require.ErrorContains(t, <-writeDone, "terminal closed")
}

func TestTerminalServiceShutdownRetriesCloseAfterUnblockingInFlightWrite(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 4, testutil.NewTestLogger())
	closeErr := errors.New("interrupt terminal close failed once")
	terminal := &shutdownRetryCloseTerminal{
		started: make(chan struct{}), release: make(chan struct{}), closeErr: closeErr,
	}
	service.ptys["term-1"] = terminal
	service.lastUsed["term-1"] = time.Now()

	writeDone := make(chan error, 1)
	go func() {
		_, err := service.Write("term-1", "payload")
		writeDone <- err
	}()
	<-terminal.started

	err := service.Shutdown()

	require.ErrorIs(t, err, closeErr)
	require.ErrorContains(t, <-writeDone, "terminal closed")
	require.Equal(t, 2, terminal.CloseCount())
	require.Equal(t, 0, service.Count())
}
