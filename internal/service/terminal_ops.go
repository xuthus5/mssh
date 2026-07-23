package service

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/xuthus5/mssh/pkg/event"
)

// Single Write payload bound for user input / paste via IPC. Matches pending output cap.
const maxTerminalWriteBytes = 1 << 20

// PTY geometry bounds accepted from the frontend Resize path.
const (
	minTerminalCols = 1
	minTerminalRows = 1
	maxTerminalCols = 1000
	maxTerminalRows = 500
)

func validateTerminalID(terminalID string) error {
	if strings.TrimSpace(terminalID) == "" {
		return fmt.Errorf("invalid terminal id")
	}
	return nil
}

func validateTerminalWrite(data string) error {
	if len(data) > maxTerminalWriteBytes {
		return fmt.Errorf("terminal write exceeds %d bytes", maxTerminalWriteBytes)
	}
	if !utf8.ValidString(data) {
		return fmt.Errorf("terminal write must be valid UTF-8")
	}
	return nil
}

func validateTerminalSize(cols, rows int) error {
	if cols < minTerminalCols || cols > maxTerminalCols {
		return fmt.Errorf("terminal cols must be between %d and %d", minTerminalCols, maxTerminalCols)
	}
	if rows < minTerminalRows || rows > maxTerminalRows {
		return fmt.Errorf("terminal rows must be between %d and %d", minTerminalRows, maxTerminalRows)
	}
	return nil
}

func (t *TerminalService) Write(terminalID string, data string) (int, error) {
	if err := validateTerminalID(terminalID); err != nil {
		return 0, err
	}
	if err := validateTerminalWrite(data); err != nil {
		return 0, err
	}
	t.logger.Debug("writing to terminal", "terminalID", terminalID, "len", len(data))
	t.mu.RLock()
	pty, ok := t.ptys[terminalID]
	t.mu.RUnlock()
	if !ok {
		return 0, fmt.Errorf("terminal %s not found", terminalID)
	}

	t.mu.Lock()
	t.lastUsed[terminalID] = time.Now()
	t.mu.Unlock()

	return pty.Write([]byte(data))
}

func (t *TerminalService) Resize(terminalID string, cols, rows int) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	if err := validateTerminalSize(cols, rows); err != nil {
		return err
	}
	t.logger.Info("resizing terminal", "terminalID", terminalID, "cols", cols, "rows", rows)
	t.mu.RLock()
	pty, ok := t.ptys[terminalID]
	t.mu.RUnlock()
	if !ok {
		return fmt.Errorf("terminal %s not found", terminalID)
	}

	t.mu.Lock()
	t.lastUsed[terminalID] = time.Now()
	t.mu.Unlock()

	return pty.Resize(cols, rows)
}

func (t *TerminalService) Close(terminalID string) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	t.logger.Info("closing terminal", "terminalID", terminalID)
	if t.clearBufferedTerminal(terminalID) {
		return nil
	}
	pty, connID, closeHandler, ok := t.detachTerminal(terminalID)
	if !ok {
		t.logger.Error("close terminal failed", "terminalID", terminalID, "error", "terminal not found")
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	if pty != nil {
		_ = pty.Close()
	}
	t.releaseSerialDevice(terminalID, pty)
	if closeHandler != nil {
		closeHandler(terminalID)
	}
	if t.sessionSvc != nil && connID != "" {
		_ = t.sessionSvc.disconnect(connID, false)
	}
	t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{TerminalID: terminalID, State: "closed"})
	return nil
}

func (t *TerminalService) clearBufferedTerminal(terminalID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, active := t.ptys[terminalID]; active {
		return false
	}
	if _, buffered := t.pendingOutput[terminalID]; !buffered {
		return false
	}
	t.outputMu.Lock()
	delete(t.pendingOutput, terminalID)
	delete(t.attached, terminalID)
	delete(t.outputSequences, terminalID)
	delete(t.systemSamples, terminalID)
	t.outputMu.Unlock()
	t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{TerminalID: terminalID, State: "closed"})
	return true
}

func (t *TerminalService) detachTerminal(terminalID string) (terminalIO, string, func(string), bool) {
	t.mu.Lock()
	pty, ok := t.ptys[terminalID]
	if !ok {
		t.mu.Unlock()
		return nil, "", nil, false
	}
	t.outputMu.Lock()
	delete(t.ptys, terminalID)
	delete(t.lastUsed, terminalID)
	delete(t.attached, terminalID)
	delete(t.pendingOutput, terminalID)
	connID := t.connIDs[terminalID]
	delete(t.connIDs, terminalID)
	delete(t.sessionIDs, terminalID)
	delete(t.outputSequences, terminalID)
	delete(t.systemSamples, terminalID)
	closeHandler := t.closeHandler
	t.outputMu.Unlock()
	t.mu.Unlock()
	return pty, connID, closeHandler, true
}

func (t *TerminalService) Count() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.ptys)
}

func (t *TerminalService) SetMaxSize(maxSize int) error {
	if maxSize <= 0 {
		return fmt.Errorf("max terminal pool size must be greater than zero")
	}
	t.mu.Lock()
	t.maxSize = maxSize
	t.mu.Unlock()
	return nil
}
