package service

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

type blockingOutputBus struct {
	mu      sync.Mutex
	events  []CapturedEvent
	blocked chan struct{}
	release chan struct{}
}

type controlledTerminalTimer struct {
	stopResult bool
	stopped    chan struct{}
	stopOnce   sync.Once
}

func newControlledTerminalTimer(stopResult bool) *controlledTerminalTimer {
	return &controlledTerminalTimer{stopResult: stopResult, stopped: make(chan struct{})}
}

func (t *controlledTerminalTimer) Stop() bool {
	t.stopOnce.Do(func() { close(t.stopped) })
	return t.stopResult
}

func newBlockingOutputBus() *blockingOutputBus {
	return &blockingOutputBus{blocked: make(chan struct{}), release: make(chan struct{})}
}

func (b *blockingOutputBus) Emit(name string, payload interface{}) {
	if output, ok := payload.(event.TerminalOutputPayload); name == event.TerminalOutput && ok && string(output.Data) == "old" {
		close(b.blocked)
		<-b.release
	}
	b.mu.Lock()
	b.events = append(b.events, CapturedEvent{Name: name, Payload: payload})
	b.mu.Unlock()
}

func (b *blockingOutputBus) Events() []CapturedEvent {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]CapturedEvent(nil), b.events...)
}

func TestTerminalService_AttachOrdersPendingBeforeLiveOutput(t *testing.T) {
	bus := newBlockingOutputBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.ptys["term-1"] = nil
	service.pendingOutput["term-1"] = []byte("old")
	attached := make(chan error, 1)
	go func() { attached <- service.Attach("term-1") }()
	<-bus.blocked

	liveDone := make(chan struct{})
	go func() { service.handlePTYOutput("term-1", []byte("new")); close(liveDone) }()
	close(bus.release)
	require.NoError(t, <-attached)
	<-liveDone

	events := bus.Events()
	require.Len(t, events, 2)
	assert.Equal(t, []byte("old"), events[0].Payload.(event.TerminalOutputPayload).Data)
	assert.Equal(t, []byte("new"), events[1].Payload.(event.TerminalOutputPayload).Data)
	assert.Equal(t, uint64(1), events[0].Payload.(event.TerminalOutputPayload).Sequence)
	assert.Equal(t, uint64(2), events[1].Payload.(event.TerminalOutputPayload).Sequence)
}

func TestTerminalService_OutputSequenceIsPerTerminal(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.ptys["term-1"] = nil
	service.ptys["term-2"] = nil
	service.attached["term-1"] = true
	service.attached["term-2"] = true

	service.handlePTYOutput("term-1", []byte("one"))
	service.handlePTYOutput("term-2", []byte("two"))
	service.handlePTYOutput("term-1", []byte("three"))

	events := bus.Events()
	require.Len(t, events, 3)
	assert.Equal(t, uint64(1), events[0].Payload.(event.TerminalOutputPayload).Sequence)
	assert.Equal(t, uint64(1), events[1].Payload.(event.TerminalOutputPayload).Sequence)
	assert.Equal(t, uint64(2), events[2].Payload.(event.TerminalOutputPayload).Sequence)
}

func TestTerminalService_SplitsOversizedOutputWithoutDroppingBytes(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.ptys["term-large"] = nil
	service.attached["term-large"] = true
	data := make([]byte, maxPendingTerminalOutput+17)
	for index := range data {
		data[index] = byte(index % 251)
	}

	service.handlePTYOutput("term-large", data)
	events := bus.Events()
	require.Len(t, events, 2)
	var combined []byte
	for index, captured := range events {
		payload := captured.Payload.(event.TerminalOutputPayload)
		assert.Equal(t, uint64(index+1), payload.Sequence)
		combined = append(combined, payload.Data...)
	}
	assert.Equal(t, data, combined)
}

func TestTerminalService_SlowOutputDoesNotBlockAnotherTerminal(t *testing.T) {
	bus := newBlockingOutputBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.ptys["term-1"] = nil
	service.ptys["term-2"] = nil
	service.attached["term-1"] = true
	service.attached["term-2"] = true

	firstDone := make(chan struct{})
	go func() {
		service.handlePTYOutput("term-1", []byte("old"))
		close(firstDone)
	}()
	<-bus.blocked

	secondDone := make(chan struct{})
	go func() {
		service.handlePTYOutput("term-2", []byte("new"))
		close(secondDone)
	}()
	select {
	case <-secondDone:
	case <-time.After(time.Second):
		t.Fatal("output from another terminal was blocked")
	}
	close(bus.release)
	select {
	case <-firstDone:
	case <-time.After(time.Second):
		t.Fatal("slow terminal output did not finish")
	}
}

func TestTerminalService_CloseWaitsForPendingOutputDrain(t *testing.T) {
	bus := newBlockingOutputBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.ptys["term-1"] = nil
	service.pendingOutput["term-1"] = []byte("old")
	attached := make(chan error, 1)
	go func() { attached <- service.Attach("term-1") }()
	<-bus.blocked

	closed := make(chan error, 1)
	go func() { closed <- service.Close("term-1") }()
	close(bus.release)
	require.NoError(t, <-attached)
	require.NoError(t, <-closed)

	events := bus.Events()
	require.Len(t, events, 2)
	assert.Equal(t, event.TerminalOutput, events[0].Name)
	assert.Equal(t, event.TerminalClosed, events[1].Name)
}

func TestTerminalService_PendingOutputBackpressuresWithoutDroppingBytes(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.ptys["term-1"] = nil
	data := make([]byte, maxPendingTerminalOutput+1024)
	for index := range data {
		data[index] = byte(index % 251)
	}
	done := make(chan struct{})
	go func() {
		service.handlePTYOutput("term-1", data)
		close(done)
	}()

	require.Eventually(t, func() bool {
		service.mu.RLock()
		defer service.mu.RUnlock()
		return len(service.pendingOutput["term-1"]) == maxPendingTerminalOutput
	}, time.Second, time.Millisecond)
	select {
	case <-done:
		t.Fatal("pending output returned before the terminal attached")
	default:
	}

	require.NoError(t, service.Attach("term-1"))
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("pending output did not resume after attach")
	}

	var combined []byte
	for _, captured := range bus.Events() {
		if captured.Name != event.TerminalOutput {
			continue
		}
		combined = append(combined, captured.Payload.(event.TerminalOutputPayload).Data...)
	}
	assert.Equal(t, data, combined)
}

func TestTerminalService_CloseCleansDetachedBufferedTerminal(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.pendingOutput["term-1"] = []byte("final output")

	require.NoError(t, service.Close("term-1"))

	_, exists := service.pendingOutput["term-1"]
	assert.False(t, exists)
	lastEvent := bus.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TerminalClosed, lastEvent.Name)
}

func TestCloseAllTerminalsCleansDetachedBufferedTerminal(t *testing.T) {
	bus := newMockEventBus()
	service := NewTerminalService(nil, bus, 32, testutil.NewTestLogger())
	service.pendingOutput["term-detached"] = []byte("final output")

	require.NoError(t, CloseAllTerminals(service))

	_, exists := service.pendingOutput["term-detached"]
	assert.False(t, exists)
	lastEvent := bus.LastEvent()
	require.NotNil(t, lastEvent)
	assert.Equal(t, event.TerminalClosed, lastEvent.Name)
}

func TestTerminalShutdownStopsPendingOutputExpiry(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger())
	expiry := newPendingOutputExpiry()
	timer := newControlledTerminalTimer(true)
	expiry.timer = timer
	service.pendingOutput["term-expiry"] = []byte("final output")
	service.pendingExpiries["term-expiry"] = expiry

	require.NoError(t, service.Shutdown())

	select {
	case <-timer.stopped:
	default:
		t.Fatal("terminal shutdown did not stop the pending output expiry")
	}
	select {
	case <-expiry.done:
	default:
		t.Fatal("stopped pending output expiry did not finish")
	}
	assert.Empty(t, service.pendingOutput)
	assert.Empty(t, service.pendingExpiries)
}

func TestTerminalShutdownWaitsForStartedPendingOutputExpiry(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger())
	expiry := newPendingOutputExpiry()
	timer := newControlledTerminalTimer(false)
	expiry.timer = timer
	service.pendingOutput["term-expiry"] = []byte("final output")
	service.pendingExpiries["term-expiry"] = expiry

	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- service.Shutdown() }()
	select {
	case <-timer.stopped:
	case <-time.After(time.Second):
		t.Fatal("terminal shutdown did not attempt to stop the pending output expiry")
	}
	select {
	case shutdownErr := <-shutdownDone:
		t.Fatalf("terminal shutdown returned before the started expiry completed: %v", shutdownErr)
	case <-time.After(50 * time.Millisecond):
	}

	service.expirePendingOutputIfCurrent("term-expiry", expiry)
	expiry.finish()
	select {
	case shutdownErr := <-shutdownDone:
		require.NoError(t, shutdownErr)
	case <-time.After(time.Second):
		t.Fatal("terminal shutdown did not finish after the expiry callback completed")
	}
	assert.Empty(t, service.pendingOutput)
}
