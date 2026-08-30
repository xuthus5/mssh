package service

import (
	"errors"
	"io"
	"net"
	"strings"
	"sync"

	"github.com/xuthus5/mssh/pkg/event"
)

func (t *TerminalService) terminalExitGeneration() uint64 {
	t.exitMu.Lock()
	defer t.exitMu.Unlock()
	return t.exitGeneration
}

func (t *TerminalService) beginTerminalExitCallback(generation uint64) (func(), bool) {
	t.exitMu.Lock()
	if t.exitStopping || generation != t.exitGeneration {
		t.exitMu.Unlock()
		return nil, false
	}
	t.exitWG.Add(1)
	t.exitMu.Unlock()
	var finishOnce sync.Once
	return func() { finishOnce.Do(t.exitWG.Done) }, true
}

func (t *TerminalService) stopTerminalExitCallbacks() {
	t.exitMu.Lock()
	t.exitStopping = true
	t.exitGeneration++
	t.exitMu.Unlock()
	t.exitWG.Wait()
}

func (t *TerminalService) resumeTerminalExitCallbacks() {
	t.exitMu.Lock()
	t.exitStopping = false
	t.exitMu.Unlock()
}

// describeExitReason normalizes a PTY exit error into a compact, greppable reason.
// The raw error stays available via the `error` log field.
func describeExitReason(err error) string {
	if err == nil {
		return "clean-exit"
	}
	if errors.Is(err, io.EOF) {
		return "remote-eof"
	}
	if errors.Is(err, net.ErrClosed) {
		return "local-close"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "timeout"
	}
	if strings.Contains(strings.ToLower(err.Error()), "reset") {
		return "connection-reset"
	}
	return "unknown"
}

func (t *TerminalService) handlePTYExit(terminalID string, exitedPTY terminalIO, exitErr error) {
	t.drainTerminalOutputBatch(terminalID)
	t.mu.Lock()
	if t.ignorePTYExitLocked(terminalID, exitedPTY) {
		t.mu.Unlock()
		return
	}
	dispatcher := t.lockOutputDispatcher(terminalID)
	t.outputMu.Lock()
	delete(t.ptys, terminalID)
	delete(t.closingPTYs, terminalID)
	delete(t.lastUsed, terminalID)
	wasAttached := t.attached[terminalID]
	if wasAttached {
		delete(t.attached, terminalID)
		delete(t.pendingOutput, terminalID)
	}
	connID := t.connIDs[terminalID]
	sessionID := t.sessionIDs[terminalID]
	delete(t.connIDs, terminalID)
	delete(t.sessionIDs, terminalID)
	delete(t.outputSequences, terminalID)
	closeOutputFlowLocked(t, terminalID)
	t.releaseProbeTerminalRef(sessionID)
	closeHandler := t.closeHandler
	expirePending := !t.attached[terminalID] && len(t.pendingOutput[terminalID]) > 0
	t.updatePendingSessionOwnerLocked(terminalID, sessionID, expirePending)
	t.outputMu.Unlock()
	t.unlockOutputDispatcher(terminalID, dispatcher)
	t.mu.Unlock()
	t.deleteSystemSample(terminalID)

	if closeHandler != nil {
		closeHandler(terminalID)
	}
	t.releaseSerialDevice(terminalID, exitedPTY)
	if t.sessionSvc != nil && connID != "" {
		if err := t.sessionSvc.disconnect(connID, false); err != nil {
			t.logger.Debug("remote terminal connection cleanup failed", "terminalID", terminalID, "error", err)
		}
	}
	t.eventBus.Emit(event.ConnectionState, event.ConnectionStatePayload{
		TerminalID: terminalID,
		State:      "disconnected",
	})
	if expirePending {
		t.schedulePendingOutputExpiry(terminalID)
	}
	t.logger.Info("terminal disconnected by remote",
		"terminalID", terminalID,
		"sessionID", sessionID,
		"attached", wasAttached,
		"openTerminals", t.Count(),
		"reason", describeExitReason(exitErr),
		"error", exitErr,
	)
}

func (t *TerminalService) ignorePTYExitLocked(terminalID string, exitedPTY terminalIO) bool {
	currentPTY, ok := t.ptys[terminalID]
	if !ok || currentPTY != exitedPTY {
		return true
	}
	closingPTY, closing := t.closingPTYs[terminalID]
	return closing && closingPTY == exitedPTY
}
