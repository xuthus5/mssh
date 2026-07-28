package service

import "errors"

var errAuditServiceStopped = errors.New("audit service is shutting down")

func (a *AuditService) beginOperation() (func(), error) {
	if a == nil {
		return nil, errAuditServiceStopped
	}
	return a.lifecycle.begin(errAuditServiceStopped)
}

// Shutdown rejects new audit operations and waits for active calls.
//
//wails:ignore
func (a *AuditService) Shutdown() {
	if a == nil {
		return
	}
	a.lifecycle.stopAndWait()
}
