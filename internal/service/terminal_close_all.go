package service

// CloseAllTerminals closes every active PTY without exposing a Wails service method.
func CloseAllTerminals(service *TerminalService) error {
	if service == nil {
		return nil
	}
	return service.closeAll(false)
}
