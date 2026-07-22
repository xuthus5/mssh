package service

import (
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
