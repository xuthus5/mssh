package service

import "errors"

var errSerialServiceStopped = errors.New("serial service is shutting down")

func (s *SerialService) beginOperation() (func(), error) {
	if s == nil {
		return nil, errSerialServiceStopped
	}
	return s.lifecycle.begin(errSerialServiceStopped)
}

// Shutdown rejects new serial operations and waits for active calls.
//
//wails:ignore
func (s *SerialService) Shutdown() {
	if s == nil {
		return
	}
	s.lifecycle.stopAndWait()
}
