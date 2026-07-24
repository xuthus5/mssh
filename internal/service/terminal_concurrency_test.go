package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/pkg/event"
)

type synchronousExitPTY struct {
	mu           sync.Mutex
	exitCallback func(error)
	closeCount   int
}

func (p *synchronousExitPTY) Write(data []byte) (int, error) {
	return len(data), nil
}

func (p *synchronousExitPTY) Resize(int, int) error {
	return nil
}

func (p *synchronousExitPTY) Close() error {
	p.mu.Lock()
	p.closeCount++
	callback := p.exitCallback
	p.mu.Unlock()
	if callback != nil {
		callback(nil)
	}
	return nil
}

func (p *synchronousExitPTY) SetReadCallback(func([]byte)) {}

func (p *synchronousExitPTY) SetExitCallback(callback func(error)) {
	p.mu.Lock()
	p.exitCallback = callback
	p.mu.Unlock()
}

func (p *synchronousExitPTY) Start() {}

func (p *synchronousExitPTY) CloseCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.closeCount
}

func TestRegisterTerminalEvictsSynchronousExitWithoutBlocking(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 1, testutil.NewTestLogger())
	oldPTY := &synchronousExitPTY{}
	service.registerTerminal("old", "", 0, oldPTY)

	completed := make(chan struct{})
	go func() {
		service.registerTerminal("new", "", 0, &synchronousExitPTY{})
		close(completed)
	}()

	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("pool-full registration blocked while closing the LRU terminal")
	}
	require.Equal(t, 1, oldPTY.CloseCount())
	require.Equal(t, 1, service.Count())
}

func TestHandlePTYExitDeletesSystemSampleUnderSystemLock(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 1, testutil.NewTestLogger())
	pty := &synchronousExitPTY{}
	service.mu.Lock()
	service.ptys["term-1"] = pty
	service.lastUsed["term-1"] = time.Now()
	service.mu.Unlock()

	service.systemMu.Lock()
	service.systemSamples["term-1"] = systemSample{total: 1, at: time.Now()}
	locked := true
	defer func() {
		if locked {
			service.systemMu.Unlock()
		}
	}()

	completed := make(chan struct{})
	go func() {
		service.handlePTYExit("term-1", pty, nil)
		close(completed)
	}()

	select {
	case <-completed:
		t.Fatal("system sample deletion bypassed systemMu")
	case <-time.After(50 * time.Millisecond):
	}
	service.systemMu.Unlock()
	locked = false

	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("terminal exit did not resume after releasing systemMu")
	}
	service.systemMu.Lock()
	_, exists := service.systemSamples["term-1"]
	service.systemMu.Unlock()
	require.False(t, exists)
}

func TestCloseAllTerminalsWaitsForInFlightOpen(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newManualHostKeyEventBus()
	sessionService := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	address, stop := sshtestutil.NewMockServer(t)
	t.Cleanup(stop)
	session, err := sessionService.CreateSession(model.SessionInputFrom(model.Session{
		Name: "close-all-terminal", Host: "127.0.0.1", Port: parsePort(t, address),
		Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30,
	}))
	require.NoError(t, err)
	service := NewTerminalService(sessionService, bus, 4, testutil.NewTestLogger())

	openDone := make(chan error, 1)
	go func() {
		_, openErr := service.Open(context.Background(), session.ID, 80, 24)
		openDone <- openErr
	}()
	require.Eventually(t, func() bool { return bus.hasEvent(event.HostKeyFingerprint) }, time.Second, 5*time.Millisecond)

	closeDone := make(chan error, 1)
	go func() { closeDone <- CloseAllTerminals(service) }()
	select {
	case closeErr := <-closeDone:
		require.NoError(t, closeErr)
	case <-time.After(time.Second):
		t.Fatal("CloseAllTerminals did not finish")
	}

	select {
	case openErr := <-openDone:
		require.Error(t, openErr)
	case <-time.After(time.Second):
		t.Fatal("CloseAllTerminals returned before the in-flight open finished")
	}
	assert.Equal(t, 0, service.Count())

	_, err = service.Open(context.Background(), 999, 80, 24)
	require.Error(t, err)
	assert.NotContains(t, err.Error(), "shutting down")
}

func TestTerminalServiceShutdownRejectsNewOpens(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 4, testutil.NewTestLogger())
	require.NoError(t, service.Shutdown())
	require.NoError(t, service.Shutdown())

	_, err := service.OpenLocal(context.Background(), 80, 24)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "shutting down")
}

func TestTerminalServiceOpenLocalHonorsCancelledContext(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 4, testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := service.OpenLocal(ctx, 80, 24)
	assert.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 0, service.Count())
}

func TestTerminalServiceOpenSerialHonorsCancelledContext(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 4, testutil.NewTestLogger())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := service.OpenSerial(ctx, 1, 80, 24)
	assert.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 0, service.Count())
}

func TestTerminalLifecycleNilAndErrorBranches(t *testing.T) {
	var service *TerminalService
	require.NoError(t, service.Shutdown())
	require.NoError(t, CloseAllTerminals(service))
	require.NoError(t, contextError(nil))

	first := errors.New("first")
	second := errors.New("second")
	joined := joinTerminalCloseError(nil, "one", first)
	assert.ErrorIs(t, joined, first)
	joined = joinTerminalCloseError(joined, "two", second)
	assert.ErrorIs(t, joined, first)
	assert.ErrorIs(t, joined, second)
}
