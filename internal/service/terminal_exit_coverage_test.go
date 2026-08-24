package service

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/pkg/event"
)

type stubPTY struct {
	closed bool
}

// We cannot easily construct real PTYSession; exercise handlePTYExit with map injection of nil-safe path via fake by using real map entries with nil PTY and ensuring no panic on mismatch.

func TestHandlePTYExitIgnoresStaleAndCleansCurrent(t *testing.T) {
	bus := newMockEventBus()
	sessionSvc := NewSessionService(testutil.NewTestDB(t), bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewTerminalService(sessionSvc, bus, 4, testutil.NewTestLogger())
	closed := false
	svc.closeHandler = func(id string) { closed = true }

	// inject terminal entry with nil pty pointer cast workaround: use empty PTYSession zero value if type allows
	fake := &ssh.PTYSession{}
	svc.mu.Lock()
	svc.ptys["term-exit"] = fake
	svc.lastUsed["term-exit"] = time.Now()
	svc.attached["term-exit"] = true
	svc.connIDs["term-exit"] = "conn-missing"
	svc.pendingOutput["term-exit"] = []byte("pending")
	svc.mu.Unlock()

	// stale exit ignored
	svc.handlePTYExit("term-exit", &ssh.PTYSession{}, nil)
	svc.mu.RLock()
	_, still := svc.ptys["term-exit"]
	svc.mu.RUnlock()
	assert.True(t, still)

	// matching exit cleans
	svc.handlePTYExit("term-exit", fake, assert.AnError)
	svc.mu.RLock()
	_, still = svc.ptys["term-exit"]
	svc.mu.RUnlock()
	assert.False(t, still)
	assert.True(t, closed)
	assert.True(t, bus.hasEvent(event.ConnectionState))
}

func TestEvictLRUEmitsClosed(t *testing.T) {
	bus := newMockEventBus()
	svc := NewTerminalService(nil, bus, 1, testutil.NewTestLogger())
	closed := false
	svc.closeHandler = func(string) { closed = true }
	fake := &ssh.PTYSession{}
	svc.mu.Lock()
	svc.ptys["old"] = fake
	svc.lastUsed["old"] = time.Now().Add(-time.Minute)
	svc.attached["old"] = false
	svc.mu.Unlock()
	svc.evictLRU()
	assert.True(t, closed)
	assert.True(t, bus.hasEvent(event.TerminalClosed))
	require.Equal(t, 0, svc.Count())
}

type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return false }

func TestDescribeExitReason(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"clean exit", nil, "clean-exit"},
		{"remote eof", io.EOF, "remote-eof"},
		{"local close", net.ErrClosed, "local-close"},
		{"timeout", &net.OpError{Op: "read", Err: timeoutError{}}, "timeout"},
		{"connection reset", &net.OpError{Op: "read", Err: errors.New("read tcp 1.2.3.4:22: connection reset by peer")}, "connection-reset"},
		{"unknown", errors.New("ssh: handshake failed"), "unknown"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, describeExitReason(tc.err))
		})
	}
}

func TestHandlePTYExitLogsDetailedReason(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	bus := newMockEventBus()
	svc := NewTerminalService(nil, bus, 4, logger)
	fake := &ssh.PTYSession{}
	svc.mu.Lock()
	svc.ptys["term-log"] = fake
	svc.lastUsed["term-log"] = time.Now()
	svc.attached["term-log"] = true
	svc.connIDs["term-log"] = "conn"
	svc.mu.Unlock()

	svc.handlePTYExit("term-log", fake, &net.OpError{Op: "read", Err: errors.New("connection reset by peer")})

	output := buf.String()
	assert.Contains(t, output, "terminal disconnected by remote")
	assert.Contains(t, output, `"reason":"connection-reset"`)
	assert.Contains(t, output, `"attached":true`)
	assert.Contains(t, output, `"openTerminals":0`)
}

func TestCloseLogsAppState(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	bus := newMockEventBus()
	svc := NewTerminalService(nil, bus, 4, logger)
	fake := &ssh.PTYSession{}
	svc.mu.Lock()
	svc.ptys["term-close"] = fake
	svc.lastUsed["term-close"] = time.Now()
	svc.mu.Unlock()

	require.NoError(t, svc.closeTerminal("term-close"))

	output := buf.String()
	assert.Contains(t, output, "closing terminal")
	assert.Contains(t, output, `"state":"closed"`)
	assert.Contains(t, output, "terminal closed by app")
}
