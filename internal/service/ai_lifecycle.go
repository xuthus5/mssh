package service

import (
	"context"
	"errors"
	"sync"

	"github.com/xuthus5/mssh/internal/store"
)

var errAIServiceStopped = errors.New("AI service is shutting down")

type aiServiceLifecycle struct {
	once    sync.Once
	mu      sync.Mutex
	ctx     context.Context
	cancel  context.CancelFunc
	workers sync.WaitGroup
	stopped bool
}

func (lifecycle *aiServiceLifecycle) initialize() {
	lifecycle.once.Do(func() {
		lifecycle.ctx, lifecycle.cancel = context.WithCancel(context.Background())
	})
}

func (s *AIService) beginOperation() (context.Context, func(), error) {
	if s == nil {
		return nil, nil, errAIServiceStopped
	}
	s.lifecycle.initialize()
	s.lifecycle.mu.Lock()
	if s.lifecycle.stopped {
		s.lifecycle.mu.Unlock()
		return nil, nil, errAIServiceStopped
	}
	operationContext, cancel := context.WithCancel(s.lifecycle.ctx)
	s.lifecycle.workers.Add(1)
	s.lifecycle.mu.Unlock()
	return operationContext, func() {
		cancel()
		s.lifecycle.workers.Done()
	}, nil
}

// Shutdown cancels network work, rejects new operations, and waits for active calls.
//
//wails:ignore
func (s *AIService) Shutdown() {
	if s == nil {
		return
	}
	s.lifecycle.initialize()
	s.agent.mu.Lock()
	s.agent.stopping = true
	s.agent.mu.Unlock()
	s.lifecycle.mu.Lock()
	s.lifecycle.stopped = true
	cancel := s.lifecycle.cancel
	s.lifecycle.mu.Unlock()
	cancel()
	s.lifecycle.workers.Wait()
	if s.db != nil {
		if err := store.MarkAIAgentTasksInterrupted(s.db); err != nil && s.logger != nil {
			s.logger.Error("mark AI agent tasks interrupted failed", "error", err)
		}
	}
	if s.secrets != nil {
		s.secrets.clearMemory()
	}
}
