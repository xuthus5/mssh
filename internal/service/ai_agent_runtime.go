package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
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

func (s *AIService) StartAgentTask(input model.AIAgentTaskInput) (*model.AIAgentTask, error) {
	if err := s.validateAIAgentTaskInput(&input); err != nil {
		return nil, err
	}
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return nil, err
	}
	engine, cli, err := resolveAIAgentSelection(input, settings.Interaction.Agent)
	if err != nil {
		return nil, err
	}
	if engine == model.AIAgentEngineLocalCLI {
		if err = validateInstalledAIAgentCLI(cli, settings.Interaction.Agent.AllowCodex); err != nil {
			return nil, err
		}
	}
	task, err := store.CreateAIAgentTask(s.db, input, engine, cli)
	if err != nil {
		return nil, normalizeAIAgentTaskCreateError(err)
	}
	if err = s.launchAIAgentTask(task.ID); err != nil {
		_ = store.UpdateAIAgentTaskStatus(s.db, task.ID, model.AIAgentTaskFailed, "", err.Error())
		return nil, err
	}
	return s.GetAgentTask(task.ID)
}

func (s *AIService) ListAgentTasks(sessionID int64, limit int) ([]model.AIAgentTask, error) {
	if sessionID < 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	if limit <= 0 {
		limit = defaultAIAgentTaskLimit
	}
	if limit > maxAIAgentTaskLimit {
		return nil, fmt.Errorf("AI agent task limit must not exceed %d", maxAIAgentTaskLimit)
	}
	return store.ListAIAgentTasks(s.db, sessionID, limit)
}

func (s *AIService) GetAgentTask(taskID int64) (*model.AIAgentTask, error) {
	if taskID <= 0 {
		return nil, fmt.Errorf("invalid AI agent task id")
	}
	task, err := store.GetAIAgentTask(s.db, taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf("AI agent task %d not found", taskID)
	}
	return task, nil
}

func (s *AIService) ApproveAgentStep(taskID, stepID int64, approved bool) error {
	if taskID <= 0 || stepID <= 0 {
		return fmt.Errorf("invalid AI agent task or step id")
	}
	execution := s.agentExecution(taskID)
	if execution == nil {
		return fmt.Errorf("AI agent task %d is not running", taskID)
	}
	execution.mu.Lock()
	decision := execution.approvals[stepID]
	execution.mu.Unlock()
	if decision == nil {
		return fmt.Errorf("AI agent step %d is not awaiting approval", stepID)
	}
	if err := store.ResolveAIAgentStepApproval(s.db, taskID, stepID, approved); err != nil {
		return err
	}
	select {
	case decision <- approved:
		s.emitAIAgentStep(taskID, stepID)
		return nil
	default:
		return fmt.Errorf("AI agent step %d approval was already resolved", stepID)
	}
}

func (s *AIService) CancelAgentTask(taskID int64) error {
	execution := s.agentExecution(taskID)
	if execution == nil {
		return fmt.Errorf("AI agent task %d is not active", taskID)
	}
	execution.cancel()
	return nil
}

// DeleteAgentTask cancels an active execution (when present) and removes the
// task together with its steps.
func (s *AIService) DeleteAgentTask(taskID int64) error {
	if taskID <= 0 {
		return fmt.Errorf("invalid AI agent task id")
	}
	if execution := s.agentExecution(taskID); execution != nil {
		execution.cancel()
		s.waitForAIAgentExecutionRelease(taskID)
	}
	if err := store.DeleteAIAgentTask(s.db, taskID); err != nil {
		return err
	}
	if s.eventBus != nil {
		s.eventBus.Emit(event.AIAgentTaskChanged, nil)
	}
	return nil
}

func (s *AIService) waitForAIAgentExecutionRelease(taskID int64) {
	deadline := time.Now().Add(agentTaskDeleteGrace)
	for time.Now().Before(deadline) {
		if s.agentExecution(taskID) == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	s.logger.Warn("AI agent task delete wait timed out", "taskID", taskID)
}

func (s *AIService) ResumeAgentTask(taskID int64) (*model.AIAgentTask, error) {
	if taskID <= 0 {
		return nil, fmt.Errorf("invalid AI agent task id")
	}
	task, err := s.GetAgentTask(taskID)
	if err != nil {
		return nil, err
	}
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return nil, err
	}
	if task.StepCount >= settings.Security.MaxPlanSteps {
		return nil, fmt.Errorf("AI agent task reached the maximum of %d steps", settings.Security.MaxPlanSteps)
	}
	if err := store.ResumeAIAgentTask(s.db, taskID); err != nil {
		return nil, normalizeAIAgentTaskCreateError(err)
	}
	if err := s.launchAIAgentTask(taskID); err != nil {
		_ = store.UpdateAIAgentTaskStatus(s.db, taskID, model.AIAgentTaskInterrupted, "", err.Error())
		return nil, err
	}
	return s.GetAgentTask(taskID)
}

// RetryAgentTask creates and starts a new task from a failed task's original
// execution parameters (session, prompt, engine and CLI).
func (s *AIService) RetryAgentTask(taskID int64) (*model.AIAgentTask, error) {
	if taskID <= 0 {
		return nil, fmt.Errorf("invalid AI agent task id")
	}
	task, err := s.GetAgentTask(taskID)
	if err != nil {
		return nil, err
	}
	if task.Status != model.AIAgentTaskFailed {
		return nil, fmt.Errorf("AI agent task %d cannot be retried in %s status", taskID, task.Status)
	}
	engine := task.Engine
	cli := task.CLI
	return s.StartAgentTask(model.AIAgentTaskInput{
		SessionID: task.SessionID,
		Prompt:    task.Prompt,
		Engine:    &engine,
		CLI:       &cli,
	})
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

func (s *AIService) validateAIAgentTaskInput(input *model.AIAgentTaskInput) error {
	input.Prompt = strings.TrimSpace(input.Prompt)
	if input.SessionID <= 0 || input.Prompt == "" {
		return fmt.Errorf("session and task prompt are required")
	}
	if len(input.Prompt) > maxAIAgentPromptBytes {
		return fmt.Errorf("AI agent task prompt is too large")
	}
	if s.sessions == nil {
		return fmt.Errorf("AI agent SSH runtime is unavailable")
	}
	if _, err := store.GetSession(s.db, input.SessionID); err != nil {
		return err
	}
	return nil
}

func resolveAIAgentSelection(input model.AIAgentTaskInput, defaults model.AIAgentSettings) (model.AIAgentEngine, model.AIAgentCLI, error) {
	engine := defaults.DefaultEngine
	cli := defaults.DefaultCLI
	if input.Engine != nil {
		engine = *input.Engine
	}
	if input.CLI != nil {
		cli = *input.CLI
	}
	if err := validateAIAgentSettings(model.AIAgentSettings{DefaultEngine: engine, DefaultCLI: cli}); err != nil {
		return "", "", err
	}
	if engine == model.AIAgentEngineNative {
		cli = ""
	}
	return engine, cli, nil
}

func validateInstalledAIAgentCLI(cli model.AIAgentCLI, allowCodex bool) error {
	if _, err := newAIAgentCLIAdapter(cli, allowCodex); err != nil {
		return err
	}
	status := detectAICLI(string(cli), string(cli))
	if !status.Installed || status.Error != "" {
		return fmt.Errorf("AI agent CLI %s is unavailable: %s", cli, status.Error)
	}
	return nil
}

func validateAIAgentDefaultAvailability(settings model.AIAgentSettings) error {
	if settings.DefaultEngine == model.AIAgentEngineNative {
		return nil
	}
	return validateInstalledAIAgentCLI(settings.DefaultCLI, settings.AllowCodex)
}

func normalizeAIAgentTaskCreateError(err error) error {
	if strings.Contains(strings.ToLower(err.Error()), "unique constraint failed") {
		return fmt.Errorf("this SSH session already has an active AI agent task")
	}
	return err
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
