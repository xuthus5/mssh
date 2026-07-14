package service

import (
	"fmt"
	"time"

	"github.com/xuthus5/mssh/pkg/event"
)

const (
	maxPendingTerminalOutput = 1 << 20
	pendingOutputTTL         = time.Minute
)

func (t *TerminalService) Attach(terminalID string) error {
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
	if !active {
		delete(t.attached, terminalID)
	}
	t.mu.Unlock()
	if len(pending) > 0 {
		t.dispatchTerminalOutput(terminalID, pending, handler)
	}
	t.outputMu.Unlock()
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
	t.outputMu.Lock()
	handler := t.outputHandler
	t.mu.Unlock()
	t.dispatchTerminalOutput(terminalID, data, handler)
	t.outputMu.Unlock()
}

func (t *TerminalService) dispatchTerminalOutput(terminalID string, data []byte, handler func(string, []byte)) {
	t.eventBus.Emit(event.TerminalOutput, event.TerminalOutputPayload{TerminalID: terminalID, Data: string(data)})
	if handler != nil {
		handler(terminalID, data)
	}
}

func (t *TerminalService) expirePendingOutput(terminalID string) {
	t.mu.Lock()
	if _, active := t.ptys[terminalID]; !active && !t.attached[terminalID] {
		delete(t.pendingOutput, terminalID)
	}
	t.mu.Unlock()
}
