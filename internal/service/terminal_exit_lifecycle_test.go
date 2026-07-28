package service

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestTerminalShutdownWaitsForRemoteExitCallback(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 2, testutil.NewTestLogger())
	callbackStarted := make(chan struct{})
	releaseCallback := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseCallback) }) }
	t.Cleanup(release)
	service.SetCloseHandler(func(string) {
		close(callbackStarted)
		<-releaseCallback
	})
	terminal := &manualExitTerminal{}
	service.registerTerminal("term-exit", "", 0, terminal)
	callbackDone := make(chan struct{})
	go func() {
		terminal.exit(nil)
		close(callbackDone)
	}()
	select {
	case <-callbackStarted:
	case <-time.After(time.Second):
		t.Fatal("terminal exit callback did not reach close handler")
	}

	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- service.Shutdown() }()
	select {
	case shutdownErr := <-shutdownDone:
		t.Fatalf("terminal shutdown returned before exit callback completed: %v", shutdownErr)
	case <-time.After(50 * time.Millisecond):
	}

	release()
	select {
	case <-callbackDone:
	case <-time.After(time.Second):
		t.Fatal("terminal exit callback did not finish")
	}
	select {
	case shutdownErr := <-shutdownDone:
		require.NoError(t, shutdownErr)
	case <-time.After(time.Second):
		t.Fatal("terminal shutdown did not finish after exit callback")
	}
}

func TestCloseAllTerminalsReopensExitCallbacks(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 2, testutil.NewTestLogger())
	closed := make(chan string, 2)
	service.SetCloseHandler(func(terminalID string) { closed <- terminalID })
	first := &manualExitTerminal{}
	service.registerTerminal("first", "", 0, first)

	require.NoError(t, CloseAllTerminals(service))
	require.Equal(t, "first", <-closed)
	second := &manualExitTerminal{}
	service.registerTerminal("second", "", 0, second)
	second.exit(nil)

	require.Equal(t, "second", <-closed)
	require.Equal(t, 0, service.Count())
}

func TestLateTerminalExitFromPreviousGenerationIsIgnored(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 2, testutil.NewTestLogger())
	previous := &manualExitTerminal{}
	service.registerTerminal("term", "", 0, previous)
	require.NoError(t, CloseAllTerminals(service))

	current := &manualExitTerminal{}
	service.registerTerminal("term", "", 0, current)
	previous.exit(nil)
	require.Equal(t, 1, service.Count())
	current.exit(nil)
	require.Equal(t, 0, service.Count())
}

func TestTerminalExitAndCloseAllConverge(t *testing.T) {
	for attempt := 0; attempt < 50; attempt++ {
		service := NewTerminalService(nil, newMockEventBus(), 2, testutil.NewTestLogger())
		terminal := &manualExitTerminal{}
		service.registerTerminal("term", "", 0, terminal)
		start := make(chan struct{})
		exitDone := make(chan struct{})
		closeDone := make(chan error, 1)
		go func() {
			<-start
			terminal.exit(nil)
			close(exitDone)
		}()
		go func() {
			<-start
			closeDone <- CloseAllTerminals(service)
		}()
		close(start)
		select {
		case <-exitDone:
		case <-time.After(time.Second):
			t.Fatal("terminal exit did not finish")
		}
		select {
		case closeErr := <-closeDone:
			require.NoError(t, closeErr)
		case <-time.After(time.Second):
			t.Fatal("close all terminals did not finish")
		}
		require.Equal(t, 0, service.Count())
	}
}

type manualExitTerminal struct {
	mu       sync.Mutex
	callback func(error)
}

func (t *manualExitTerminal) Write(data []byte) (int, error) { return len(data), nil }

func (t *manualExitTerminal) Resize(int, int) error { return nil }

func (t *manualExitTerminal) Close() error { return nil }

func (t *manualExitTerminal) SetReadCallback(func([]byte)) {}

func (t *manualExitTerminal) SetExitCallback(callback func(error)) {
	t.mu.Lock()
	t.callback = callback
	t.mu.Unlock()
}

func (t *manualExitTerminal) Start() {}

func (t *manualExitTerminal) exit(err error) {
	t.mu.Lock()
	callback := t.callback
	t.mu.Unlock()
	if callback != nil {
		callback(err)
	}
}
