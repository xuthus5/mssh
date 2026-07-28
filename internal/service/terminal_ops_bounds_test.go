package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

type stubTerminalIO struct {
	writes   [][]byte
	cols     int
	rows     int
	closeErr error
}

func (s *stubTerminalIO) Write(data []byte) (int, error) {
	s.writes = append(s.writes, append([]byte(nil), data...))
	return len(data), nil
}

func (s *stubTerminalIO) Resize(cols, rows int) error {
	s.cols, s.rows = cols, rows
	return nil
}

func (s *stubTerminalIO) Close() error { return s.closeErr }

func (s *stubTerminalIO) SetReadCallback(func([]byte)) {}

func (s *stubTerminalIO) SetExitCallback(func(error)) {}

func (s *stubTerminalIO) Start() {}

type retryCloseTerminalIO struct {
	mu           sync.Mutex
	closeErrors  []error
	closeCalls   int
	exitCallback func(error)
}

func (t *retryCloseTerminalIO) Write(data []byte) (int, error) { return len(data), nil }

func (t *retryCloseTerminalIO) Resize(int, int) error { return nil }

func (t *retryCloseTerminalIO) Close() error {
	t.mu.Lock()
	call := t.closeCalls
	t.closeCalls++
	callback := t.exitCallback
	var closeErr error
	if call < len(t.closeErrors) {
		closeErr = t.closeErrors[call]
	}
	t.mu.Unlock()
	if callback != nil {
		callback(closeErr)
	}
	return closeErr
}

func (t *retryCloseTerminalIO) SetReadCallback(func([]byte)) {}

func (t *retryCloseTerminalIO) SetExitCallback(callback func(error)) {
	t.mu.Lock()
	t.exitCallback = callback
	t.mu.Unlock()
}

func (t *retryCloseTerminalIO) Start() {}

func (t *retryCloseTerminalIO) CloseCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.closeCalls
}

func TestTerminalService_WriteRejectsOversizedPayload(t *testing.T) {
	stub := &stubTerminalIO{}
	svc := &TerminalService{
		logger:   testutil.NewTestLogger(),
		ptys:     map[string]terminalIO{"term-1": stub},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}
	payload := strings.Repeat("a", maxTerminalWriteBytes+1)
	_, err := svc.Write("term-1", payload)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds")
	assert.Empty(t, stub.writes)
}

func TestTerminalService_WriteRejectsInvalidUTF8(t *testing.T) {
	stub := &stubTerminalIO{}
	svc := &TerminalService{
		logger:   testutil.NewTestLogger(),
		ptys:     map[string]terminalIO{"term-1": stub},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}
	_, err := svc.Write("term-1", string([]byte{0xff, 0xfe}))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "UTF-8")
	assert.Empty(t, stub.writes)
}

func TestTerminalService_WriteAcceptsBoundaryPayload(t *testing.T) {
	stub := &stubTerminalIO{}
	svc := &TerminalService{
		logger:   testutil.NewTestLogger(),
		ptys:     map[string]terminalIO{"term-1": stub},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}
	payload := strings.Repeat("b", maxTerminalWriteBytes)
	n, err := svc.Write("term-1", payload)
	require.NoError(t, err)
	assert.Equal(t, maxTerminalWriteBytes, n)
	require.Len(t, stub.writes, 1)
	assert.Len(t, stub.writes[0], maxTerminalWriteBytes)
}

func TestTerminalService_ResizeRejectsInvalidGeometry(t *testing.T) {
	stub := &stubTerminalIO{}
	svc := &TerminalService{
		logger:   testutil.NewTestLogger(),
		ptys:     map[string]terminalIO{"term-1": stub},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}
	assert.Error(t, svc.Resize("term-1", 0, 24))
	assert.Error(t, svc.Resize("term-1", 80, 0))
	assert.Error(t, svc.Resize("term-1", maxTerminalCols+1, 24))
	assert.Error(t, svc.Resize("term-1", 80, maxTerminalRows+1))
	assert.Equal(t, 0, stub.cols)
	assert.Equal(t, 0, stub.rows)

	require.NoError(t, svc.Resize("term-1", maxTerminalCols, maxTerminalRows))
	assert.Equal(t, maxTerminalCols, stub.cols)
	assert.Equal(t, maxTerminalRows, stub.rows)
}

func TestTerminalService_OpenRejectsInvalidGeometry(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger()}
	_, err := svc.OpenLocal(t.Context(), 0, 24)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cols")
}

func TestTerminalService_RejectsEmptyTerminalID(t *testing.T) {
	svc := &TerminalService{
		logger:   testutil.NewTestLogger(),
		ptys:     map[string]terminalIO{},
		lastUsed: map[string]time.Time{},
	}
	_, err := svc.Write("", "x")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid terminal id")
	require.Error(t, svc.Resize("   ", 80, 24))
	require.Error(t, svc.Close(""))
	require.Error(t, svc.Attach(""))
}

func TestTerminalService_OpenRejectsInvalidSessionID(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger()}
	_, err := svc.Open(context.Background(), 0, 80, 24)
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid session id")
}

func TestTerminalServiceTerminalSessionID(t *testing.T) {
	svc := &TerminalService{sessionIDs: map[string]int64{"ssh": 7, "local": 0}}
	sessionID, ok := svc.terminalSessionID("ssh")
	assert.True(t, ok)
	assert.Equal(t, int64(7), sessionID)
	_, ok = svc.terminalSessionID("local")
	assert.False(t, ok)
	_, ok = svc.terminalSessionID("missing")
	assert.False(t, ok)
}

func TestTerminalServiceCloseReportsCleanupErrorsAfterDetach(t *testing.T) {
	sessionService := NewSessionService(nil, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewTerminalService(sessionService, newMockEventBus(), 2, testutil.NewTestLogger())
	service.ptys["term-1"] = &stubTerminalIO{}
	service.connIDs["term-1"] = "missing-connection"
	service.lastUsed["term-1"] = time.Now()

	err := service.Close("term-1")
	require.Error(t, err)
	assert.ErrorContains(t, err, "disconnect terminal connection")
	assert.Equal(t, 0, service.Count())
	_, exists := service.lastUsed["term-1"]
	assert.False(t, exists)
}

func TestTerminalServiceCloseRetainsTerminalAfterIOCloseFailureForRetry(t *testing.T) {
	closeErr := errors.New("terminal close failed once")
	terminal := &retryCloseTerminalIO{closeErrors: []error{closeErr, nil}}
	service := NewTerminalService(nil, newMockEventBus(), 2, testutil.NewTestLogger())
	closed := 0
	service.SetCloseHandler(func(string) { closed++ })
	require.NoError(t, service.registerTerminal("term-1", "", 0, terminal))

	err := service.Close("term-1")

	require.ErrorIs(t, err, closeErr)
	assert.Equal(t, 1, service.Count())
	assert.Equal(t, 1, terminal.CloseCount())
	assert.Equal(t, 0, closed)

	require.NoError(t, service.Close("term-1"))
	assert.Equal(t, 0, service.Count())
	assert.Equal(t, 2, terminal.CloseCount())
	assert.Equal(t, 1, closed)
}

func TestTerminalServiceRegistrationDoesNotExceedCapacityWhenEvictionFails(t *testing.T) {
	closeErr := errors.New("terminal cannot close")
	existing := &retryCloseTerminalIO{closeErrors: []error{closeErr}}
	service := NewTerminalService(nil, newMockEventBus(), 1, testutil.NewTestLogger())
	service.ptys["existing"] = existing
	service.lastUsed["existing"] = time.Now()

	err := service.registerTerminalState(terminalRegistration{
		terminalID: "new",
		pty:        &retryCloseTerminalIO{},
	})

	require.ErrorIs(t, err, closeErr)
	assert.Equal(t, 1, service.Count())
	assert.Contains(t, service.ptys, "existing")
	assert.NotContains(t, service.ptys, "new")
}

func TestTerminalServiceSetMaxSizeEvictsAllExcessAndBoundsFutureRegistrations(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 4, testutil.NewTestLogger())
	base := time.Now()
	terminals := make([]*retryCloseTerminalIO, 0, 4)
	for index := 0; index < 4; index++ {
		terminal := &retryCloseTerminalIO{}
		terminalID := fmt.Sprintf("term-%d", index)
		terminals = append(terminals, terminal)
		service.ptys[terminalID] = terminal
		service.lastUsed[terminalID] = base.Add(time.Duration(index) * time.Second)
	}

	require.NoError(t, service.SetMaxSize(2))
	assert.Equal(t, 2, service.MaxSize())
	assert.Equal(t, 2, service.Count())
	assert.Equal(t, 2, totalTerminalCloseCalls(terminals))

	newTerminal := &retryCloseTerminalIO{}
	require.NoError(t, service.registerTerminalState(terminalRegistration{terminalID: "term-new", pty: newTerminal}))
	assert.Equal(t, 2, service.Count())
	assert.Equal(t, 3, totalTerminalCloseCalls(terminals))
}

func totalTerminalCloseCalls(terminals []*retryCloseTerminalIO) int {
	total := 0
	for _, terminal := range terminals {
		total += terminal.CloseCount()
	}
	return total
}
