package service

import "errors"

var errLogServiceStopped = errors.New("log service is shutting down")

func (l *LogService) beginOperation() (func(), error) {
	if l == nil {
		return nil, errLogServiceStopped
	}
	return l.lifecycle.begin(errLogServiceStopped)
}

// StopOperationsAndWait rejects new public calls while terminal output and close callbacks remain active.
//
//wails:ignore
func (l *LogService) StopOperationsAndWait() {
	if l == nil {
		return
	}
	l.mu.Lock()
	l.shuttingDown = true
	l.mu.Unlock()
	l.lifecycle.stopAndWait()
}

// Shutdown finalizes every remaining recording after public operations and terminal callbacks stop.
//
//wails:ignore
func (l *LogService) Shutdown() error {
	if l == nil {
		return nil
	}
	l.StopOperationsAndWait()
	l.shutdownOnce.Do(func() {
		l.shutdownErr = l.closeAllActiveRecordings()
	})
	return l.shutdownErr
}

// CloseAllActiveRecordings permanently stops every active recording without exposing a Wails service method.
func CloseAllActiveRecordings(logService *LogService) error {
	return logService.Shutdown()
}
