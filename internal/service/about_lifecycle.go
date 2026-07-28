package service

import (
	"context"
	"errors"
	"sync"
)

var errAboutServiceStopped = errors.New("about service is shutting down")

type aboutServiceLifecycle struct {
	once    sync.Once
	mu      sync.Mutex
	ctx     context.Context
	cancel  context.CancelFunc
	workers sync.WaitGroup
	stopped bool
}

func (lifecycle *aboutServiceLifecycle) initialize() {
	lifecycle.once.Do(func() {
		lifecycle.ctx, lifecycle.cancel = context.WithCancel(context.Background())
	})
}

func (a *AboutService) beginOperation(parent context.Context) (context.Context, func(), error) {
	if a == nil {
		return nil, nil, errAboutServiceStopped
	}
	if parent == nil {
		return nil, nil, errors.New("update check context is required")
	}
	a.lifecycle.initialize()
	a.lifecycle.mu.Lock()
	if a.lifecycle.stopped {
		a.lifecycle.mu.Unlock()
		return nil, nil, errAboutServiceStopped
	}
	operationContext, cancel := context.WithCancel(parent)
	stopShutdownCancel := context.AfterFunc(a.lifecycle.ctx, cancel)
	a.lifecycle.workers.Add(1)
	a.lifecycle.mu.Unlock()
	var finishOnce sync.Once
	return operationContext, func() {
		finishOnce.Do(func() {
			stopShutdownCancel()
			cancel()
			a.lifecycle.workers.Done()
		})
	}, nil
}

// Shutdown cancels update checks, rejects new checks, and waits for active calls.
//
//wails:ignore
func (a *AboutService) Shutdown() {
	if a == nil {
		return
	}
	a.lifecycle.initialize()
	a.lifecycle.mu.Lock()
	a.lifecycle.stopped = true
	cancel := a.lifecycle.cancel
	a.lifecycle.mu.Unlock()
	cancel()
	a.lifecycle.workers.Wait()
}
