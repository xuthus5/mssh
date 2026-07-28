package service

import (
	"errors"
)

var errKeyServiceStopped = errors.New("key service is shutting down")

func (k *KeyService) beginOperation() (func(), error) {
	if k == nil {
		return nil, errKeyServiceStopped
	}
	return k.lifecycle.begin(errKeyServiceStopped)
}

// Shutdown rejects new key operations and waits for active calls.
//
//wails:ignore
func (k *KeyService) Shutdown() {
	if k == nil {
		return
	}
	k.lifecycle.stopAndWait()
}
