package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const aiAgentSystemPrompt = `你是 MSSH 的远程运维 Agent。你只能通过提供的 MSSH SSH 工具操作任务绑定的 POSIX 主机。每次只输出一个严格 JSON 对象，不要使用 Markdown：
{"tool":"ssh.exec|ssh.list_dir|ssh.stat|ssh.read_file|ssh.write_file|task.finish","arguments":{...},"reason":"简短说明"}
ssh.exec 参数为 command；文件工具参数为 path；ssh.write_file 还需 content；task.finish 参数为 result。先读取和验证，再做最小修改。修改命令和写文件会等待用户逐次审批。拒绝后应重新规划。禁止交互式密码、sudo 密码和 TTY 提示。完成时必须调用 task.finish。`

type aiAgentAction struct {
	Tool      string          `json:"tool"`
	Arguments json.RawMessage `json:"arguments"`
	Reason    string          `json:"reason"`
}

type aiAgentHistoryItem struct {
	Action string `json:"action"`
	Result string `json:"result"`
}

func (s *AIService) executeAIAgent(ctx context.Context, task model.AIAgentTask, execution *aiAgentExecution) (string, error) {
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return "", err
	}
	connection, err := s.openAIAgentSSH(ctx, task.SessionID)
	if err != nil {
		return "", fmt.Errorf("open dedicated AI agent SSH connection: %w", err)
	}
	defer func() {
		if closeErr := connection.Close(); closeErr != nil {
			s.logger.Warn("close AI agent SSH connection failed", "taskID", task.ID, "error", closeErr)
		}
	}()
	switch task.Engine {
	case model.AIAgentEngineNative:
		return s.runNativeAIAgent(ctx, task, execution, connection, settings)
	case model.AIAgentEngineLocalCLI:
		return s.runLocalCLIAgent(ctx, task, execution, connection, settings)
	default:
		return "", fmt.Errorf("unsupported AI agent engine %s", task.Engine)
	}
}

func (s *AIService) runNativeAIAgent(ctx context.Context, task model.AIAgentTask, execution *aiAgentExecution, connection *aiAgentSSH, settings model.AISettings) (string, error) {
	history := aiAgentHistoryFromSteps(task.Steps)
	for sequence := task.StepCount + 1; sequence <= settings.Security.MaxPlanSteps; sequence++ {
		prompt, err := buildAIAgentPrompt(task, history)
		if err != nil {
			return "", err
		}
		action, answer, err := s.requestAIAgentAction(ctx, settings, aiChatInput{System: aiAgentSystemPrompt, Prompt: prompt})
		if err != nil {
			return "", err
		}
		result, finished, err := s.performAIAgentAction(ctx, task.ID, sequence, action, execution, connection, settings.Security)
		if err != nil {
			return "", err
		}
		if finished {
			return result, nil
		}
		history = append(history, aiAgentHistoryItem{Action: clampAITextBytes(answer, settings.Security.MaxOutputBytes), Result: result})
	}
	return "", fmt.Errorf("AI agent reached the maximum of %d steps", settings.Security.MaxPlanSteps)
}

func aiAgentHistoryFromSteps(steps []model.AIAgentStep) []aiAgentHistoryItem {
	history := make([]aiAgentHistoryItem, 0, len(steps))
	for _, step := range steps {
		result := step.ToolOutput
		if step.Error != "" {
			result = "error: " + step.Error + "\n" + result
		}
		history = append(history, aiAgentHistoryItem{Action: step.ToolName + " " + step.ToolInput, Result: result})
	}
	return history
}

func buildAIAgentPrompt(task model.AIAgentTask, history []aiAgentHistoryItem) (string, error) {
	historyJSON, err := json.Marshal(history)
	if err != nil {
		return "", fmt.Errorf("encode AI agent history: %w", err)
	}
	return fmt.Sprintf("任务：%s\n目标会话：%s\n已执行步骤：%s", task.Prompt, task.SessionName, historyJSON), nil
}

func parseAIAgentAction(answer string) (aiAgentAction, error) {
	trimmed := strings.TrimSpace(answer)
	if strings.HasPrefix(trimmed, "```") {
		firstLine := strings.IndexByte(trimmed, '\n')
		lastFence := strings.LastIndex(trimmed, "```")
		if firstLine >= 0 && lastFence > firstLine {
			trimmed = strings.TrimSpace(trimmed[firstLine+1 : lastFence])
		}
	}
	var action aiAgentAction
	decoder := json.NewDecoder(strings.NewReader(trimmed))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&action); err != nil {
		return action, err
	}
	if strings.TrimSpace(action.Tool) == "" || len(action.Arguments) == 0 {
		return action, errors.New("tool and arguments are required")
	}
	return action, nil
}

func (s *AIService) performAIAgentAction(ctx context.Context, taskID int64, sequence int, action aiAgentAction, execution *aiAgentExecution, connection *aiAgentSSH, security model.AISecuritySettings) (string, bool, error) {
	if action.Tool == "task.finish" {
		return s.finishAIAgentTask(taskID, sequence, action, security)
	}
	request, err := prepareAIAgentToolRequest(action, security)
	if err != nil {
		return "", false, err
	}
	step, err := store.CreateAIAgentStep(s.db, model.AIAgentStep{TaskID: taskID, Sequence: sequence, Kind: "tool", ModelOutput: sanitizeAIAgentText(action.Reason, security), ToolName: action.Tool, ToolInput: sanitizeAIAgentText(string(action.Arguments), security), Risk: request.Risk, ApprovalStatus: request.Approval})
	if err != nil {
		return "", false, err
	}
	proceed, response, err := s.authorizeAIAgentTool(ctx, step, request, execution)
	if err != nil || !proceed {
		return response, false, err
	}
	return s.executeAIAgentTool(ctx, step, request, connection, security)
}

func (s *AIService) finishAIAgentTask(taskID int64, sequence int, action aiAgentAction, security model.AISecuritySettings) (string, bool, error) {
	var arguments struct {
		Result string `json:"result"`
	}
	if err := decodeAIAgentArguments(action.Arguments, &arguments); err != nil {
		return "", false, err
	}
	result := sanitizeAIAgentText(arguments.Result, security)
	step := model.AIAgentStep{TaskID: taskID, Sequence: sequence, Kind: "finish", ModelOutput: sanitizeAIAgentText(action.Reason, security), ToolName: action.Tool, ToolInput: `{}`, ToolOutput: result, Risk: model.AICommandRiskReadOnly, ApprovalStatus: model.AIAgentApprovalNotRequired}
	created, err := store.CreateAIAgentStep(s.db, step)
	if err != nil {
		return "", false, err
	}
	s.emitAIAgentStep(taskID, created.ID)
	return result, true, nil
}

func (s *AIService) authorizeAIAgentTool(ctx context.Context, step *model.AIAgentStep, request aiAgentToolRequest, execution *aiAgentExecution) (bool, string, error) {
	if request.Blocked != "" {
		if err := store.UpdateAIAgentStepResult(s.db, step.ID, "", request.Blocked); err != nil {
			return false, "", err
		}
		s.emitAIAgentStep(step.TaskID, step.ID)
		return false, "blocked: " + request.Blocked, nil
	}
	if request.Approval == model.AIAgentApprovalPending {
		approved, err := s.awaitAIAgentApproval(ctx, step.TaskID, step.ID, execution)
		if err != nil {
			return false, "", err
		}
		if !approved {
			const rejected = "用户拒绝了该工具调用；请重新规划"
			if err := store.UpdateAIAgentStepResult(s.db, step.ID, rejected, ""); err != nil {
				return false, "", err
			}
			s.emitAIAgentStep(step.TaskID, step.ID)
			return false, rejected, nil
		}
	} else {
		s.emitAIAgentStep(step.TaskID, step.ID)
	}
	return true, "", nil
}

func (s *AIService) executeAIAgentTool(ctx context.Context, step *model.AIAgentStep, request aiAgentToolRequest, connection *aiAgentSSH, security model.AISecuritySettings) (string, bool, error) {
	output, executeErr := connection.Execute(ctx, request)
	output = sanitizeAIAgentText(output, security)
	stepError := ""
	if executeErr != nil {
		stepError = sanitizeAIAgentText(executeErr.Error(), security)
	}
	if err := store.UpdateAIAgentStepResult(s.db, step.ID, output, stepError); err != nil {
		return "", false, err
	}
	s.emitAIAgentStep(step.TaskID, step.ID)
	if executeErr != nil {
		return "error: " + stepError + "\n" + output, false, nil
	}
	return output, false, nil
}

func decodeAIAgentArguments(data json.RawMessage, output any) error {
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("decode AI agent tool arguments: %w", err)
	}
	return nil
}

func sanitizeAIAgentText(value string, security model.AISecuritySettings) string {
	return clampAITextBytes(redactAIText(value, security.RedactionPatterns), security.MaxOutputBytes)
}

func (s *AIService) awaitAIAgentApproval(ctx context.Context, taskID, stepID int64, execution *aiAgentExecution) (bool, error) {
	decision := make(chan bool, 1)
	execution.mu.Lock()
	execution.approvals[stepID] = decision
	execution.mu.Unlock()
	defer func() {
		execution.mu.Lock()
		delete(execution.approvals, stepID)
		execution.mu.Unlock()
	}()
	if err := store.UpdateAIAgentTaskStatus(s.db, taskID, model.AIAgentTaskWaitingApproval, "", ""); err != nil {
		return false, err
	}
	s.emitAIAgentStep(taskID, stepID)
	s.emitAIAgentTask(taskID)
	select {
	case approved := <-decision:
		if err := store.UpdateAIAgentTaskStatus(s.db, taskID, model.AIAgentTaskRunning, "", ""); err != nil {
			return false, err
		}
		s.emitAIAgentTask(taskID)
		return approved, nil
	case <-ctx.Done():
		return false, ctx.Err()
	}
}
