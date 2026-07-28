package service

import (
	"errors"
)

var errSettingServiceStopped = errors.New("setting service is shutting down")

func (s *SettingService) beginOperation() (func(), error) {
	if s == nil {
		return nil, errSettingServiceStopped
	}
	return s.lifecycle.begin(errSettingServiceStopped)
}

// Shutdown rejects new setting operations and waits for active calls.
//
//wails:ignore
func (s *SettingService) Shutdown() {
	if s == nil {
		return
	}
	s.lifecycle.stopAndWait()
}
