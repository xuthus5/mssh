package service

import (
	"context"
	"errors"
	"sync"
)

var errSyncServiceStopped = errors.New("sync service is shutting down")

func (s *SyncService) beginSyncOperation() error {
	if s == nil {
		return errSyncServiceStopped
	}
	if !s.operationMu.TryLock() {
		return errSyncOperationRunning
	}
	if s.isStopped() {
		s.operationMu.Unlock()
		return errSyncServiceStopped
	}
	return nil
}

func (s *SyncService) beginReadOperation() (func(), error) {
	if s == nil {
		return nil, errSyncServiceStopped
	}
	s.shutdownMu.Lock()
	if s.stopped {
		s.shutdownMu.Unlock()
		return nil, errSyncServiceStopped
	}
	s.readOperations.Add(1)
	s.shutdownMu.Unlock()
	var finishOnce sync.Once
	return func() {
		finishOnce.Do(s.readOperations.Done)
	}, nil
}

func (s *SyncService) lockSyncOperation() error {
	if s == nil {
		return errSyncServiceStopped
	}
	s.operationMu.Lock()
	if s.isStopped() {
		s.operationMu.Unlock()
		return errSyncServiceStopped
	}
	return nil
}

func (s *SyncService) beginCancelableSyncOperation(parent context.Context) (context.Context, func(), error) {
	if parent == nil {
		return nil, nil, errors.New("sync operation context is required")
	}
	if s == nil || !s.operationMu.TryLock() {
		if s == nil {
			return nil, nil, errSyncServiceStopped
		}
		return nil, nil, errSyncOperationRunning
	}
	s.shutdownMu.Lock()
	if s.stopped {
		s.shutdownMu.Unlock()
		s.operationMu.Unlock()
		return nil, nil, errSyncServiceStopped
	}
	operationContext, cancel := context.WithCancel(parent)
	s.activeCancel = cancel
	s.shutdownMu.Unlock()
	return operationContext, s.syncOperationFinisher(cancel), nil
}

func (s *SyncService) syncOperationFinisher(cancel context.CancelFunc) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			cancel()
			s.shutdownMu.Lock()
			s.activeCancel = nil
			s.shutdownMu.Unlock()
			s.operationMu.Unlock()
		})
	}
}

func (s *SyncService) isStopped() bool {
	s.shutdownMu.Lock()
	defer s.shutdownMu.Unlock()
	return s.stopped
}

// Shutdown stops accepting sync operations, cancels active network work, and waits for in-flight work.
//
//wails:ignore
func (s *SyncService) Shutdown() {
	if s == nil {
		return
	}
	s.shutdownMu.Lock()
	s.stopped = true
	cancel := s.activeCancel
	s.shutdownMu.Unlock()
	if cancel != nil {
		cancel()
	}
	s.StopScheduler()
	s.operationMu.Lock()
	s.readOperations.Wait()
	s.shutdownMu.Lock()
	s.activeCancel = nil
	s.shutdownMu.Unlock()
	s.operationMu.Unlock()
}
