package service

import "errors"

var errCommandHistoryStopped = errors.New("command history service is shutting down")

func (s *CommandHistoryService) beginOperation() (func(), error) {
	if s == nil {
		return nil, errCommandHistoryStopped
	}
	return s.lifecycle.begin(errCommandHistoryStopped)
}

// Shutdown rejects new command history operations and waits for active calls.
//
//wails:ignore
func (s *CommandHistoryService) Shutdown() {
	if s == nil {
		return
	}
	s.lifecycle.stopAndWait()
}
