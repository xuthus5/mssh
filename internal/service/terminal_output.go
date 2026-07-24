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

func (t *TerminalService) Attach(terminalID string) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	t.mu.Lock()
	_, active := t.ptys[terminalID]
	_, buffered := t.pendingOutput[terminalID]
	if !active && !buffered {
		t.mu.Unlock()
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	if t.attached[terminalID] {
		t.mu.Unlock()
		return nil
	}
	t.outputMu.Lock()
	t.attached[terminalID] = true
	pending := t.pendingOutput[terminalID]
	delete(t.pendingOutput, terminalID)
	handler := t.outputHandler
	dispatcher := t.outputDispatcherLocked(terminalID)
	t.outputMu.Unlock()
	dispatcher.Lock()
	if !active {
		delete(t.attached, terminalID)
	}
	t.mu.Unlock()
	if len(pending) > 0 {
		t.dispatchTerminalOutputLocked(terminalID, pending, handler)
	}
	dispatcher.Unlock()
	return nil
}

func (t *TerminalService) handlePTYOutput(terminalID string, data []byte) {
	t.mu.Lock()
	if _, ok := t.ptys[terminalID]; !ok {
		t.mu.Unlock()
		return
	}
	if !t.attached[terminalID] {
		remaining := maxPendingTerminalOutput - len(t.pendingOutput[terminalID])
		if remaining > 0 {
			if len(data) > remaining {
				data = data[:remaining]
			}
			t.pendingOutput[terminalID] = append(t.pendingOutput[terminalID], data...)
		}
		t.mu.Unlock()
		return
	}
	handler := t.outputHandler
	dispatcher := t.outputDispatcher(terminalID)
	dispatcher.Lock()
	t.mu.Unlock()
	t.dispatchTerminalOutputLocked(terminalID, data, handler)
	dispatcher.Unlock()
}

func (t *TerminalService) dispatchTerminalOutputLocked(terminalID string, data []byte, handler func(string, []byte)) {
	t.outputMu.Lock()
	if t.outputSequences == nil {
		t.outputSequences = make(map[string]uint64)
	}
	// Wails dispatches each event asynchronously, so the frontend restores PTY byte order with this sequence.
	// Clone once for the async bus; source buffers (PTY read/pending) are reused or truncated and must not be shared.
	t.outputSequences[terminalID]++
	sequence := t.outputSequences[terminalID]
	t.outputMu.Unlock()
	t.eventBus.Emit(event.TerminalOutput, event.TerminalOutputPayload{
		TerminalID: terminalID,
		Sequence:   sequence,
		Data:       cloneTerminalOutput(data),
	})
	if handler != nil {
		handler(terminalID, data)
	}
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
	t.mu.Lock()
	if _, active := t.ptys[terminalID]; !active && !t.attached[terminalID] {
		dispatcher := t.lockOutputDispatcher(terminalID)
		delete(t.pendingOutput, terminalID)
		t.outputMu.Lock()
		delete(t.outputSequences, terminalID)
		t.outputMu.Unlock()
		t.unlockOutputDispatcher(terminalID, dispatcher)
	}
	t.mu.Unlock()
}
