package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	defaultAIAgentTaskLimit = 100
	maxAIAgentTaskLimit     = 500
	maxAIAgentPromptBytes   = 32 * 1024
	agentTaskDeleteGrace    = 3 * time.Second
)

type aiAgentRuntime struct {
	mu       sync.Mutex
	tasks    map[int64]*aiAgentExecution
	stopping bool
}

type aiAgentExecution struct {
	cancel    context.CancelFunc
	done      <-chan struct{}
	mu        sync.Mutex
	approvals map[int64]chan bool
}

func (s *AIService) launchAIAgentTask(taskID int64) error {
	ctx, finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	execution := &aiAgentExecution{cancel: cancel, done: ctx.Done(), approvals: make(map[int64]chan bool)}
	s.agent.mu.Lock()
	if s.agent.stopping {
		s.agent.mu.Unlock()
		cancel()
		finish()
		return errAIServiceStopped
	}
	if s.agent.tasks == nil {
		s.agent.tasks = make(map[int64]*aiAgentExecution)
	}
	if _, exists := s.agent.tasks[taskID]; exists {
		s.agent.mu.Unlock()
		cancel()
		finish()
		return fmt.Errorf("AI agent task %d is already running", taskID)
	}
	s.agent.tasks[taskID] = execution
	s.agent.mu.Unlock()
	if err := store.UpdateAIAgentTaskStatus(s.db, taskID, model.AIAgentTaskRunning, "", ""); err != nil {
		s.removeAIAgentExecution(taskID)
		cancel()
		finish()
		return err
	}
	s.emitAIAgentTask(taskID)
	go func() {
		defer finish()
		defer cancel()
		defer s.removeAIAgentExecution(taskID)
		s.runAIAgentTask(ctx, taskID, execution)
	}()
	return nil
}

func (s *AIService) runAIAgentTask(ctx context.Context, taskID int64, execution *aiAgentExecution) {
	task, err := store.GetAIAgentTask(s.db, taskID)
	if err == nil && task == nil {
		err = fmt.Errorf("AI agent task %d not found", taskID)
	}
	var result string
	if err == nil {
		result, err = s.executeAIAgent(ctx, *task, execution)
	}
	status := model.AIAgentTaskCompleted
	taskError := ""
	if err != nil {
		taskError = redactAIText(err.Error(), nil)
		status = model.AIAgentTaskFailed
		if errors.Is(err, context.Canceled) {
			status = model.AIAgentTaskCancelled
			if s.aiAgentStopping() {
				status = model.AIAgentTaskInterrupted
			}
		}
	}
	if updateErr := store.UpdateAIAgentTaskStatus(s.db, taskID, status, result, taskError); updateErr != nil {
		s.logger.Error("finish AI agent task failed", "taskID", taskID, "error", updateErr)
	}
	s.emitAIAgentTask(taskID)
}

func (s *AIService) agentExecution(taskID int64) *aiAgentExecution {
	s.agent.mu.Lock()
	defer s.agent.mu.Unlock()
	return s.agent.tasks[taskID]
}

func (s *AIService) removeAIAgentExecution(taskID int64) {
	s.agent.mu.Lock()
	delete(s.agent.tasks, taskID)
	s.agent.mu.Unlock()
}

func (s *AIService) aiAgentStopping() bool {
	s.agent.mu.Lock()
	defer s.agent.mu.Unlock()
	return s.agent.stopping
}
