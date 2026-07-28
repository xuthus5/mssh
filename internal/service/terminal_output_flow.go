package service

import (
	"sync"
	"time"
)

const terminalOutputPauseLease = 30 * time.Second

type terminalOutputFlow struct {
	mu           sync.Mutex
	paused       bool
	closed       bool
	resumed      chan struct{}
	pauseTimer   *time.Timer
	pauseTimeout time.Duration
}

func newTerminalOutputFlow() *terminalOutputFlow {
	return newTerminalOutputFlowWithTimeout(terminalOutputPauseLease)
}

func newTerminalOutputFlowWithTimeout(timeout time.Duration) *terminalOutputFlow {
	return &terminalOutputFlow{pauseTimeout: timeout}
}

func (f *terminalOutputFlow) pause() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed || f.paused {
		return
	}
	f.paused = true
	f.resumed = make(chan struct{})
	if f.pauseTimeout > 0 {
		f.pauseTimer = time.AfterFunc(f.pauseTimeout, f.expirePause)
	}
}

func (f *terminalOutputFlow) resume() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resumeLocked()
}

func (f *terminalOutputFlow) close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return
	}
	f.closed = true
	if f.pauseTimer != nil {
		f.pauseTimer.Stop()
		f.pauseTimer = nil
	}
	if f.paused {
		f.paused = false
		close(f.resumed)
		f.resumed = nil
	}
}

func (f *terminalOutputFlow) expirePause() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed || !f.paused {
		return
	}
	f.pauseTimer = nil
	f.paused = false
	close(f.resumed)
	f.resumed = nil
}

func (f *terminalOutputFlow) resumeLocked() {
	if f.closed || !f.paused {
		return
	}
	if f.pauseTimer != nil {
		f.pauseTimer.Stop()
		f.pauseTimer = nil
	}
	f.paused = false
	close(f.resumed)
	f.resumed = nil
}

func (f *terminalOutputFlow) wait() bool {
	f.mu.Lock()
	for f.paused && !f.closed {
		resumed := f.resumed
		f.mu.Unlock()
		<-resumed
		f.mu.Lock()
	}
	open := !f.closed
	f.mu.Unlock()
	return open
}

func (t *TerminalService) outputFlowLocked(terminalID string) *terminalOutputFlow {
	if t.outputFlows == nil {
		t.outputFlows = make(map[string]*terminalOutputFlow)
	}
	flow := t.outputFlows[terminalID]
	if flow == nil {
		flow = newTerminalOutputFlow()
		t.outputFlows[terminalID] = flow
	}
	return flow
}

func closeOutputFlowLocked(t *TerminalService, terminalID string) {
	flow := t.outputFlows[terminalID]
	if flow == nil {
		return
	}
	flow.close()
	delete(t.outputFlows, terminalID)
}

// SetOutputPaused applies lossless backpressure to a terminal's PTY reader.
// A missing terminal is treated as idempotent cleanup because stale frontend
// callbacks may arrive after a terminal has already exited.
func (t *TerminalService) SetOutputPaused(terminalID string, paused bool) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	finish, err := t.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	t.mu.RLock()
	flow := t.outputFlows[terminalID]
	t.mu.RUnlock()
	if flow == nil {
		return nil
	}
	if paused {
		flow.pause()
		return nil
	}
	flow.resume()
	return nil
}
