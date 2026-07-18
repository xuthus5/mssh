package service

import "errors"

// CloseAllTerminals closes every active PTY without exposing a Wails service method.
func CloseAllTerminals(service *TerminalService) error {
	if service == nil {
		return nil
	}
	service.mu.RLock()
	terminalIDs := make([]string, 0, len(service.ptys))
	for terminalID := range service.ptys {
		terminalIDs = append(terminalIDs, terminalID)
	}
	service.mu.RUnlock()
	var closeErr error
	for _, terminalID := range terminalIDs {
		if err := service.Close(terminalID); err != nil {
			closeErr = errors.Join(closeErr, err)
		}
	}
	return closeErr
}
