package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/xuthus5/mssh/pkg/event"
)

const (
	maxPendingTerminalOutput = 1 << 20
	pendingOutputTTL         = time.Minute
)

type terminalTimer interface {
	Stop() bool
}

type pendingOutputExpiry struct {
	timer terminalTimer
	done  chan struct{}
	once  sync.Once
}

func newPendingOutputExpiry() *pendingOutputExpiry {
	return &pendingOutputExpiry{done: make(chan struct{})}
}

func (e *pendingOutputExpiry) finish() {
	if e == nil {
		return
	}
	e.once.Do(func() { close(e.done) })
}

func (e *pendingOutputExpiry) stopAndWait() {
	if e == nil {
		return
	}
	if e.timer == nil || e.timer.Stop() {
		e.finish()
	}
	<-e.done
}

func (t *TerminalService) Attach(terminalID string) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	finish, err := t.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	t.mu.Lock()
	_, active := t.ptys[terminalID]
	_, buffered := t.pendingOutput[terminalID]
	if !active && !buffered {
		t.mu.Unlock()
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	if flow := t.outputFlows[terminalID]; flow != nil {
		flow.resume()
	}
	if t.attached[terminalID] {
		expiry := t.takePendingOutputExpiryLocked(terminalID)
		t.mu.Unlock()
		expiry.stopAndWait()
		return nil
	}
	t.outputMu.Lock()
	t.attached[terminalID] = true
	pending := t.pendingOutput[terminalID]
	delete(t.pendingOutput, terminalID)
	delete(t.pendingSessionIDs, terminalID)
	expiry := t.takePendingOutputExpiryLocked(terminalID)
	handler := t.outputHandler
	dispatcher := t.outputDispatcherLocked(terminalID)
	t.outputMu.Unlock()
	dispatcher.Lock()
	if !active {
		delete(t.attached, terminalID)
	}
	t.mu.Unlock()
	expiry.stopAndWait()
	if len(pending) > 0 {
		t.dispatchTerminalOutputLocked(terminalID, pending, handler)
	}
	dispatcher.Unlock()
	return nil
}

func (t *TerminalService) handlePTYOutput(terminalID string, data []byte) {
	remaining := data
	for {
		stage := t.stagePTYOutput(terminalID, remaining)
		if !stage.active {
			return
		}
		if stage.attached {
			if stage.flow != nil && !t.traceFlowWait(terminalID, stage.flow) {
				return
			}
			if len(stage.remaining) > 0 {
				t.dispatchLiveOutput(terminalID, stage.remaining)
			}
			return
		}
		if !stage.wait || stage.flow == nil || !stage.flow.wait() {
			return
		}
		remaining = stage.remaining
	}
}

func (t *TerminalService) dispatchLiveOutput(terminalID string, data []byte) {
	start := time.Now()
	t.mu.Lock()
	if _, ok := t.ptys[terminalID]; !ok || !t.attached[terminalID] {
		t.mu.Unlock()
		return
	}
	handler := t.outputHandler
	dispatcher := t.outputDispatcherLocked(terminalID)
	dispatcher.Lock()
	t.mu.Unlock()
	t.dispatchTerminalOutputLocked(terminalID, data, handler)
	dispatcher.Unlock()
	t.traceOutputDispatched(terminalID, data, start)
}

func (t *TerminalService) dispatchTerminalOutputLocked(terminalID string, data []byte, handler func(string, []byte)) {
	t.outputMu.Lock()
	if t.outputSequences == nil {
		t.outputSequences = make(map[string]uint64)
	}
	// Wails dispatches each event asynchronously, so the frontend restores PTY byte order with this sequence.
	// Split oversized callbacks before cloning so the event cap never drops bytes.
	chunks := splitTerminalOutput(data)
	payloads := make([]event.TerminalOutputPayload, 0, len(chunks))
	for _, chunk := range chunks {
		t.outputSequences[terminalID]++
		sequence := t.outputSequences[terminalID]
		payloads = append(payloads, event.TerminalOutputPayload{
			TerminalID: terminalID,
			Sequence:   sequence,
			Data:       cloneTerminalOutput(chunk),
		})
	}
	t.outputMu.Unlock()
	for _, payload := range payloads {
		t.eventBus.Emit(event.TerminalOutput, payload)
	}
	if handler != nil {
		handler(terminalID, data)
	}
}

func splitTerminalOutput(data []byte) [][]byte {
	if len(data) == 0 {
		return [][]byte{nil}
	}
	chunks := make([][]byte, 0, (len(data)+maxPendingTerminalOutput-1)/maxPendingTerminalOutput)
	for start := 0; start < len(data); start += maxPendingTerminalOutput {
		end := start + maxPendingTerminalOutput
		if end > len(data) {
			end = len(data)
		}
		chunks = append(chunks, data[start:end])
	}
	return chunks
}

func (t *TerminalService) outputDispatcher(terminalID string) *sync.Mutex {
	t.outputMu.Lock()
	dispatcher := t.outputDispatcherLocked(terminalID)
	t.outputMu.Unlock()
	return dispatcher
}

func (t *TerminalService) outputDispatcherLocked(terminalID string) *sync.Mutex {
	if t.outputDispatchers == nil {
		t.outputDispatchers = make(map[string]*sync.Mutex)
	}
	dispatcher := t.outputDispatchers[terminalID]
	if dispatcher == nil {
		dispatcher = &sync.Mutex{}
		t.outputDispatchers[terminalID] = dispatcher
	}
	return dispatcher
}

func (t *TerminalService) lockOutputDispatcher(terminalID string) *sync.Mutex {
	dispatcher := t.outputDispatcher(terminalID)
	dispatcher.Lock()
	return dispatcher
}

func (t *TerminalService) unlockOutputDispatcher(terminalID string, dispatcher *sync.Mutex) {
	t.outputMu.Lock()
	delete(t.outputDispatchers, terminalID)
	t.outputMu.Unlock()
	dispatcher.Unlock()
}

func cloneTerminalOutput(data []byte) []byte {
	if len(data) == 0 {
		return nil
	}
	// Cap pathological payloads so emit cannot amplify beyond the pending budget.
	if len(data) > maxPendingTerminalOutput {
		data = data[:maxPendingTerminalOutput]
	}
	out := make([]byte, len(data))
	copy(out, data)
	return out
}

func (t *TerminalService) expirePendingOutput(terminalID string) {
	t.expirePendingOutputIfCurrent(terminalID, nil)
}

func (t *TerminalService) schedulePendingOutputExpiry(terminalID string) {
	t.mu.Lock()
	if t.closing || t.shuttingDown || t.attached[terminalID] || len(t.pendingOutput[terminalID]) == 0 {
		t.mu.Unlock()
		return
	}
	previous := t.takePendingOutputExpiryLocked(terminalID)
	expiry := newPendingOutputExpiry()
	expiry.timer = time.AfterFunc(pendingOutputTTL, func() {
		defer expiry.finish()
		t.expirePendingOutputIfCurrent(terminalID, expiry)
	})
	if t.pendingExpiries == nil {
		t.pendingExpiries = make(map[string]*pendingOutputExpiry)
	}
	t.pendingExpiries[terminalID] = expiry
	t.mu.Unlock()
	previous.stopAndWait()
}

func (t *TerminalService) stopPendingOutputExpiries() {
	t.mu.Lock()
	expiries := make([]*pendingOutputExpiry, 0, len(t.pendingExpiries))
	for terminalID, expiry := range t.pendingExpiries {
		expiries = append(expiries, expiry)
		delete(t.pendingExpiries, terminalID)
	}
	t.mu.Unlock()
	for _, expiry := range expiries {
		expiry.stopAndWait()
	}
}

func (t *TerminalService) takePendingOutputExpiryLocked(terminalID string) *pendingOutputExpiry {
	expiry := t.pendingExpiries[terminalID]
	delete(t.pendingExpiries, terminalID)
	return expiry
}

func (t *TerminalService) expirePendingOutputIfCurrent(terminalID string, expected *pendingOutputExpiry) {
	t.mu.Lock()
	if expected != nil {
		if t.pendingExpiries[terminalID] != expected {
			t.mu.Unlock()
			return
		}
		delete(t.pendingExpiries, terminalID)
	}
	_, buffered := t.pendingOutput[terminalID]
	if _, active := t.ptys[terminalID]; buffered && !active && !t.attached[terminalID] {
		dispatcher := t.lockOutputDispatcher(terminalID)
		delete(t.pendingOutput, terminalID)
		delete(t.pendingSessionIDs, terminalID)
		t.outputMu.Lock()
		delete(t.outputSequences, terminalID)
		t.outputMu.Unlock()
		t.unlockOutputDispatcher(terminalID, dispatcher)
	}
	t.mu.Unlock()
}
