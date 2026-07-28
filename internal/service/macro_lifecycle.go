package service

import (
	"context"
	"errors"
	"sync"
)

var errMacroServiceStopped = errors.New("macro service is shutting down")

type macroServiceLifecycle struct {
	once    sync.Once
	mu      sync.Mutex
	ctx     context.Context
	cancel  context.CancelFunc
	workers sync.WaitGroup
	stopped bool
}

func (lifecycle *macroServiceLifecycle) initialize() {
	lifecycle.once.Do(func() {
		lifecycle.ctx, lifecycle.cancel = context.WithCancel(context.Background())
	})
}

func (m *MacroService) beginOperation() (context.Context, func(), error) {
	if m == nil {
		return nil, nil, errMacroServiceStopped
	}
	m.lifecycle.initialize()
	m.lifecycle.mu.Lock()
	if m.lifecycle.stopped {
		m.lifecycle.mu.Unlock()
		return nil, nil, errMacroServiceStopped
	}
	m.lifecycle.workers.Add(1)
	operationContext := m.lifecycle.ctx
	m.lifecycle.mu.Unlock()
	var finishOnce sync.Once
	return operationContext, func() {
		finishOnce.Do(m.lifecycle.workers.Done)
	}, nil
}

// Shutdown cancels macro execution, rejects new operations, and waits for active calls.
//
//wails:ignore
func (m *MacroService) Shutdown() {
	if m == nil {
		return
	}
	m.lifecycle.initialize()
	m.lifecycle.mu.Lock()
	m.lifecycle.stopped = true
	cancel := m.lifecycle.cancel
	m.lifecycle.mu.Unlock()
	cancel()
	m.lifecycle.workers.Wait()
}
