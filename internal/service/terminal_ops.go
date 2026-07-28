package service

import (
	"errors"
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

type terminalCloseCleanup struct {
	terminalID   string
	state        string
	pty          terminalIO
	connID       string
	closeHandler func(string)
}

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
	finish, err := t.beginOperation()
	if err != nil {
		return 0, err
	}
	defer finish()
	t.logger.Debug("writing to terminal", "terminalID", terminalID, "len", len(data))
	pty, ok := t.terminalForActivity(terminalID)
	if !ok {
		return 0, fmt.Errorf("terminal %s not found", terminalID)
	}
	return pty.Write([]byte(data))
}

func (t *TerminalService) terminalForActivity(terminalID string) (terminalIO, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	pty, ok := t.ptys[terminalID]
	if !ok {
		return nil, false
	}
	if t.lastUsed == nil {
		t.lastUsed = make(map[string]time.Time)
	}
	t.lastUsed[terminalID] = time.Now()
	return pty, true
}

func (t *TerminalService) terminalSessionID(terminalID string) (int64, bool) {
	t.mu.RLock()
	sessionID, ok := t.sessionIDs[terminalID]
	t.mu.RUnlock()
	return sessionID, ok && sessionID > 0
}

func (t *TerminalService) Resize(terminalID string, cols, rows int) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	if err := validateTerminalSize(cols, rows); err != nil {
		return err
	}
	finish, err := t.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	t.logger.Info("resizing terminal", "terminalID", terminalID, "cols", cols, "rows", rows)
	pty, ok := t.terminalForActivity(terminalID)
	if !ok {
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	return pty.Resize(cols, rows)
}

func (t *TerminalService) Close(terminalID string) error {
	finish, err := t.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	return t.closeTerminal(terminalID)
}

func (t *TerminalService) closeTerminal(terminalID string) error {
	return t.closeTerminalState(terminalID, false)
}

func (t *TerminalService) closeTerminalIfPresent(terminalID string) error {
	return t.closeTerminalState(terminalID, true)
}

func (t *TerminalService) closeTerminalState(terminalID string, allowMissing bool) error {
	t.resourceMu.Lock()
	defer t.resourceMu.Unlock()
	return t.closeTerminalStateLocked(terminalID, allowMissing, "closed")
}

func (t *TerminalService) closeTerminalStateLocked(terminalID string, allowMissing bool, state string) error {
	if err := validateTerminalID(terminalID); err != nil {
		return err
	}
	t.logger.Info("closing terminal", "terminalID", terminalID)
	if t.clearBufferedTerminal(terminalID) {
		return nil
	}
	pty, ok := t.markTerminalClosing(terminalID)
	if !ok {
		if allowMissing {
			return nil
		}
		t.logger.Error("close terminal failed", "terminalID", terminalID, "error", "terminal not found")
		return fmt.Errorf("terminal %s not found", terminalID)
	}
	if pty != nil {
		if err := pty.Close(); err != nil {
			t.clearTerminalClosing(terminalID, pty)
			return fmt.Errorf("close terminal IO: %w", err)
		}
	}
	pty, connID, closeHandler, ok := t.detachTerminal(terminalID)
	if !ok {
		return nil
	}
	return t.finishTerminalClose(terminalCloseCleanup{
		terminalID:   terminalID,
		state:        state,
		pty:          pty,
		connID:       connID,
		closeHandler: closeHandler,
	})
}

func (t *TerminalService) markTerminalClosing(terminalID string) (terminalIO, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	pty, ok := t.ptys[terminalID]
	if !ok {
		return nil, false
	}
	if t.closingPTYs == nil {
		t.closingPTYs = make(map[string]terminalIO)
	}
	t.closingPTYs[terminalID] = pty
	return pty, true
}

func (t *TerminalService) clearTerminalClosing(terminalID string, pty terminalIO) {
	t.mu.Lock()
	if closingPTY, ok := t.closingPTYs[terminalID]; ok && closingPTY == pty {
		delete(t.closingPTYs, terminalID)
	}
	t.mu.Unlock()
}

func (t *TerminalService) finishTerminalClose(cleanup terminalCloseCleanup) error {
	var closeErr error
	t.releaseSerialDevice(cleanup.terminalID, cleanup.pty)
	if cleanup.closeHandler != nil {
		cleanup.closeHandler(cleanup.terminalID)
	}
	if t.sessionSvc != nil && cleanup.connID != "" {
		if err := t.sessionSvc.disconnect(cleanup.connID, false); err != nil {
			closeErr = errors.Join(closeErr, fmt.Errorf("disconnect terminal connection: %w", err))
		}
	}
	t.eventBus.Emit(event.TerminalClosed, event.ConnectionStatePayload{
		TerminalID: cleanup.terminalID,
		State:      cleanup.state,
	})
	if closeErr != nil {
		t.logger.Error("close terminal cleanup failed", "terminalID", cleanup.terminalID, "error", closeErr)
	}
	return closeErr
}

func (t *TerminalService) clearBufferedTerminal(terminalID string) bool {
	t.mu.Lock()
	if _, active := t.ptys[terminalID]; active {
		t.mu.Unlock()
		return false
	}
	if _, buffered := t.pendingOutput[terminalID]; !buffered {
		t.mu.Unlock()
		return false
	}
	expiry := t.takePendingOutputExpiryLocked(terminalID)
	dispatcher := t.lockOutputDispatcher(terminalID)
	t.outputMu.Lock()
	delete(t.pendingOutput, terminalID)
	delete(t.pendingSessionIDs, terminalID)
	delete(t.attached, terminalID)
	delete(t.outputSequences, terminalID)
	closeOutputFlowLocked(t, terminalID)
	t.outputMu.Unlock()
	t.unlockOutputDispatcher(terminalID, dispatcher)
	t.mu.Unlock()
	expiry.stopAndWait()
	t.deleteSystemSample(terminalID)
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
	dispatcher := t.lockOutputDispatcher(terminalID)
	expiry := t.takePendingOutputExpiryLocked(terminalID)
	t.outputMu.Lock()
	delete(t.ptys, terminalID)
	delete(t.closingPTYs, terminalID)
	delete(t.lastUsed, terminalID)
	delete(t.attached, terminalID)
	delete(t.pendingOutput, terminalID)
	delete(t.pendingSessionIDs, terminalID)
	connID := t.connIDs[terminalID]
	delete(t.connIDs, terminalID)
	delete(t.sessionIDs, terminalID)
	delete(t.outputSequences, terminalID)
	closeOutputFlowLocked(t, terminalID)
	closeHandler := t.closeHandler
	t.outputMu.Unlock()
	t.unlockOutputDispatcher(terminalID, dispatcher)
	t.mu.Unlock()
	expiry.stopAndWait()
	t.deleteSystemSample(terminalID)
	return pty, connID, closeHandler, true
}
