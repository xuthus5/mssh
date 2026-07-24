package service

import "fmt"

func (t *TerminalService) beginOpen() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closing || t.shuttingDown {
		return fmt.Errorf("terminal service is shutting down")
	}
	t.openWG.Add(1)
	return nil
}

func (t *TerminalService) finishOpen() {
	t.openWG.Done()
}

func (t *TerminalService) closeAll(permanent bool) error {
	t.closeMu.Lock()
	t.mu.Lock()
	t.closing = true
	if permanent {
		t.shuttingDown = true
	}
	t.mu.Unlock()
	if t.sessionSvc != nil {
		t.sessionSvc.CancelConnectAttempts()
	}
	t.openWG.Wait()
	terminalIDs := t.snapshotTerminalIDs()
	closeErr := closeTerminalIDs(t, terminalIDs)
	t.mu.Lock()
	if !permanent && !t.shuttingDown {
		t.closing = false
	}
	t.mu.Unlock()
	t.closeMu.Unlock()
	return closeErr
}

func (t *TerminalService) snapshotTerminalIDs() []string {
	t.mu.RLock()
	terminalIDs := make([]string, 0, len(t.ptys))
	for terminalID := range t.ptys {
		terminalIDs = append(terminalIDs, terminalID)
	}
	t.mu.RUnlock()
	return terminalIDs
}

func closeTerminalIDs(service *TerminalService, terminalIDs []string) error {
	var closeErr error
	for _, terminalID := range terminalIDs {
		if err := service.Close(terminalID); err != nil {
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
