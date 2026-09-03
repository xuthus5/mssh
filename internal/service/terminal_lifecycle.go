package service

import (
	"errors"
	"fmt"
	"sync"
)

var errTerminalServiceStopped = errors.New("terminal service is shutting down")

func (t *TerminalService) beginOperation() (func(), error) {
	if t == nil {
		return nil, errTerminalServiceStopped
	}
	t.mu.Lock()
	if t.closing || t.shuttingDown {
		t.mu.Unlock()
		return nil, errTerminalServiceStopped
	}
	t.operationWG.Add(1)
	t.mu.Unlock()
	var finishOnce sync.Once
	return func() { finishOnce.Do(t.operationWG.Done) }, nil
}

func (t *TerminalService) beginOpen() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closing || t.shuttingDown {
		return errTerminalServiceStopped
	}
	return nil
}

func (t *TerminalService) closeAll(permanent bool) error {
	t.closeMu.Lock()
	t.mu.Lock()
	t.closing = true
	if permanent {
		t.shuttingDown = true
	}
	t.mu.Unlock()
	if permanent && t.lifecycleCancel != nil {
		t.lifecycleCancel()
	}
	if t.sessionSvc != nil {
		t.sessionSvc.CancelConnectAttempts()
	}
	t.stopTerminalExitCallbacks()
	closeErr := closeTerminalIDsIfPresent(t, t.snapshotTerminalIDs())
	t.operationWG.Wait()
	if permanent {
		t.terminalDirectoryIntegrationWG.Wait()
	}
	t.stopPendingOutputExpiries()
	closeErr = errors.Join(closeErr, closeTerminalIDsIfPresent(t, t.snapshotTerminalIDs()))
	closeErr = errors.Join(closeErr, t.retryPendingSerialCleanups())
	t.closeAllSystemProbeConnections()
	t.mu.Lock()
	resume := !permanent && !t.shuttingDown
	t.mu.Unlock()
	if resume {
		t.resumeTerminalExitCallbacks()
		t.mu.Lock()
		t.closing = false
		t.mu.Unlock()
	}
	t.closeMu.Unlock()
	return closeErr
}

func (t *TerminalService) snapshotTerminalIDs() []string {
	t.mu.RLock()
	terminalIDs := make([]string, 0, len(t.ptys)+len(t.pendingOutput))
	seen := make(map[string]struct{}, cap(terminalIDs))
	for terminalID := range t.ptys {
		terminalIDs = append(terminalIDs, terminalID)
		seen[terminalID] = struct{}{}
	}
	for terminalID := range t.pendingOutput {
		if _, exists := seen[terminalID]; !exists {
			terminalIDs = append(terminalIDs, terminalID)
		}
	}
	t.mu.RUnlock()
	return terminalIDs
}

func closeTerminalIDs(service *TerminalService, terminalIDs []string) error {
	var closeErr error
	for _, terminalID := range terminalIDs {
		if err := service.closeTerminal(terminalID); err != nil {
			closeErr = joinTerminalCloseError(closeErr, terminalID, err)
		}
	}
	return closeErr
}

func closeTerminalIDsIfPresent(service *TerminalService, terminalIDs []string) error {
	var closeErr error
	for _, terminalID := range terminalIDs {
		if err := service.closeTerminalIfPresent(terminalID); err != nil {
			closeErr = joinTerminalCloseError(closeErr, terminalID, err)
		}
	}
	return closeErr
}

func joinTerminalCloseError(previous error, terminalID string, err error) error {
	if previous == nil {
		return fmt.Errorf("close terminal %s: %w", terminalID, err)
	}
	return fmt.Errorf("%w; close terminal %s: %w", previous, terminalID, err)
}

// Shutdown permanently rejects new terminals and closes all existing terminals.
//
//wails:ignore
func (t *TerminalService) Shutdown() error {
	if t == nil {
		return nil
	}
	return t.closeAll(true)
}
