package service

import "errors"

var errThemeServiceStopped = errors.New("theme service is shutting down")

func (service *ThemeService) beginOperation() (func(), error) {
	if service == nil {
		return nil, errThemeServiceStopped
	}
	return service.lifecycle.begin(errThemeServiceStopped)
}

// Shutdown rejects new theme operations and waits for active calls.
//
//wails:ignore
func (service *ThemeService) Shutdown() {
	if service == nil {
		return
	}
	service.lifecycle.stopAndWait()
}
