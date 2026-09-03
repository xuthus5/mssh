package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	ssh "github.com/xuthus5/mssh/internal/ssh"
)

// systemProbeConn caches a dedicated SSH connection per session used only for
// lightweight remote probing (system info / process info), so probe traffic
// never shares the interactive terminal connection.
type systemProbeConn struct {
	wrapper    *ssh.ClientWrapper
	disconnect func()
	probeRef   int
	closed     bool
}

// openSystemProbeConnection establishes a dedicated SSH connection for probing
// and returns an exactly-once disconnect that tears it down.
var _openSystemProbeConnection = openSystemProbeConnection

var probeContexts sync.Map

func openSystemProbeConnection(sessionSvc *SessionService, sessionID int64) (*ssh.ClientWrapper, func(), error) {
	if sessionSvc == nil {
		return nil, nil, errors.New("session service unavailable")
	}
	connectCtx := context.Background()
	if value, ok := probeContexts.Load(sessionSvc); ok {
		if ctx, valid := value.(context.Context); valid && ctx != nil {
			connectCtx = ctx
		}
	}
	connID, err := sessionSvc.connect(connectCtx, sessionID, false)
	if err != nil {
		return nil, nil, err
	}
	wrapper, err := sessionSvc.GetClientWrapper(connID)
	if err != nil {
		_ = sessionSvc.disconnect(connID, false)
		return nil, nil, err
	}
	var once sync.Once
	disconnect := func() { once.Do(func() { _ = sessionSvc.disconnect(connID, false) }) }
	return wrapper, disconnect, nil
}

// acquireSystemProbeConnection returns the session's dedicated probe connection,
// opening it lazily and caching it. The returned release must be called exactly
// once when the probe finishes.
func (t *TerminalService) acquireSystemProbeConnection(sessionID int64) (*ssh.ClientWrapper, func(), error) {
	if sessionID <= 0 {
		return nil, nil, fmt.Errorf("invalid session id")
	}
	t.probeMu.Lock()
	if t.probeConns == nil {
		t.probeConns = make(map[int64]*systemProbeConn)
	}
	entry := t.probeConns[sessionID]
	if entry == nil || entry.closed {
		connectCtx := context.Background()
		if t.lifecycleContext != nil {
			var cancel context.CancelFunc
			connectCtx, cancel = context.WithTimeout(t.lifecycleContext, 30*time.Second)
			defer cancel()
		}
		probeContexts.Store(t.sessionSvc, connectCtx)
		wrapper, disconnect, err := _openSystemProbeConnection(t.sessionSvc, sessionID)
		probeContexts.Delete(t.sessionSvc)
		if err != nil {
			t.probeMu.Unlock()
			return nil, nil, err
		}
		entry = &systemProbeConn{wrapper: wrapper, disconnect: disconnect}
		t.probeConns[sessionID] = entry
	}
	entry.probeRef++
	t.probeMu.Unlock()
	var once sync.Once
	return entry.wrapper, func() { once.Do(func() { t.releaseSystemProbeConnection(sessionID, entry) }) }, nil
}

func (t *TerminalService) releaseSystemProbeConnection(sessionID int64, entry *systemProbeConn) {
	t.probeMu.Lock()
	defer t.probeMu.Unlock()
	entry.probeRef--
	if entry.probeRef <= 0 && t.probeTerminalRefs[sessionID] <= 0 && !entry.closed {
		t.closeSystemProbeConnectionLocked(sessionID, entry)
	}
}

func (t *TerminalService) closeSystemProbeConnectionLocked(sessionID int64, entry *systemProbeConn) {
	if entry == nil || entry.closed {
		return
	}
	entry.closed = true
	delete(t.probeConns, sessionID)
	if entry.disconnect != nil {
		entry.disconnect()
	}
}

func (t *TerminalService) addProbeTerminalRef(sessionID int64) {
	if sessionID <= 0 {
		return
	}
	t.probeMu.Lock()
	defer t.probeMu.Unlock()
	if t.probeTerminalRefs == nil {
		t.probeTerminalRefs = make(map[int64]int)
	}
	t.probeTerminalRefs[sessionID]++
}

func (t *TerminalService) releaseProbeTerminalRef(sessionID int64) {
	if sessionID <= 0 {
		return
	}
	t.probeMu.Lock()
	defer t.probeMu.Unlock()
	remaining := t.probeTerminalRefs[sessionID] - 1
	if remaining <= 0 {
		delete(t.probeTerminalRefs, sessionID)
		remaining = 0
	} else {
		t.probeTerminalRefs[sessionID] = remaining
	}
	if entry := t.probeConns[sessionID]; entry != nil && remaining == 0 && entry.probeRef <= 0 && !entry.closed {
		t.closeSystemProbeConnectionLocked(sessionID, entry)
	}
}

func (t *TerminalService) closeAllSystemProbeConnections() {
	t.probeMu.Lock()
	defer t.probeMu.Unlock()
	for sessionID, entry := range t.probeConns {
		t.closeSystemProbeConnectionLocked(sessionID, entry)
	}
}
