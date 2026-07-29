package service

import (
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func (s *AIService) emitAIAgentTask(taskID int64) {
	if s.eventBus == nil {
		return
	}
	task, err := store.GetAIAgentTask(s.db, taskID)
	if err != nil {
		s.logger.Warn("load AI agent task event failed", "taskID", taskID, "error", err)
		return
	}
	if task != nil {
		s.eventBus.Emit(event.AIAgentTaskChanged, task)
	}
}

func (s *AIService) emitAIAgentStep(taskID, stepID int64) {
	if s.eventBus == nil {
		return
	}
	step, err := store.GetAIAgentStep(s.db, stepID)
	if err != nil {
		s.logger.Warn("load AI agent step event failed", "taskID", taskID, "stepID", stepID, "error", err)
		return
	}
	if step != nil {
		s.eventBus.Emit(event.AIAgentStepChanged, step)
	}
}
