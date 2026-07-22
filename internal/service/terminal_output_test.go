package service

import (
	"sync"
	"testing"

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

func TestTerminalService_PendingOutputIsBoundedAndExpires(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger())
	service.ptys["term-1"] = nil
	service.handlePTYOutput("term-1", make([]byte, maxPendingTerminalOutput+1024))
	assert.Len(t, service.pendingOutput["term-1"], maxPendingTerminalOutput)

	delete(service.ptys, "term-1")
	service.expirePendingOutput("term-1")
	_, exists := service.pendingOutput["term-1"]
	assert.False(t, exists)
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
