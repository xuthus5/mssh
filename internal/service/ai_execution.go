package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const maxAICommandBytes = 32 * 1024

func (s *AIService) ExecuteCommand(input model.AICommandExecutionInput) error {
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return err
	}
	proposal := classifyAICommand(input.Command, settings.Security)
	if proposal.Blocked {
		s.recordAIExecution(input, proposal.Risk, "blocked", proposal.BlockedReason)
		return fmt.Errorf("AI command blocked: %s", proposal.BlockedReason)
	}
	if !input.Approved && !proposal.CanAutoExecute {
		s.recordAIExecution(input, proposal.Risk, "blocked", "command approval is required")
		return fmt.Errorf("AI command approval is required")
	}
	if s.terminals == nil || input.TerminalID == "" {
		s.recordAIExecution(input, proposal.Risk, "failed", "active terminal is unavailable")
		return fmt.Errorf("active terminal is unavailable")
	}
	command := strings.TrimSpace(input.Command) + "\n"
	if len(command) > maxAICommandBytes {
		s.recordAIExecution(input, proposal.Risk, "blocked", "command exceeds size limit")
		return fmt.Errorf("AI command exceeds size limit")
	}
	timeout := time.Duration(settings.Security.CommandTimeoutSeconds) * time.Second
	if timeout < time.Second {
		timeout = time.Duration(defaultAISettings().Security.CommandTimeoutSeconds) * time.Second
	}
	if err := writeTerminalWithTimeout(s.terminals, input.TerminalID, command, timeout); err != nil {
		s.recordAIExecution(input, proposal.Risk, "failed", err.Error())
		return fmt.Errorf("execute AI command: %w", err)
	}
	s.recordAIExecution(input, proposal.Risk, "success", "")
	return nil
}

func writeTerminalWithTimeout(writer aiTerminalWriter, terminalID, command string, timeout time.Duration) error {
	type writeResult struct {
		err error
	}
	done := make(chan writeResult, 1)
	go func() {
		_, err := writer.Write(terminalID, command)
		done <- writeResult{err: err}
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case result := <-done:
		return result.err
	case <-timer.C:
		return fmt.Errorf("write timed out after %s", timeout)
	}
}

func (s *AIService) recordAIExecution(input model.AICommandExecutionInput, risk model.AICommandRisk, outcome, message string) {
	if err := store.RecordAICommandExecution(s.db, input, risk, outcome, message); err != nil {
		s.logger.Error("record AI command execution failed", "error", err)
	}
	auditOutcome := "success"
	if outcome != "success" {
		auditOutcome = "failed"
	}
	recordAudit(s.db, s.logger, model.AuditEvent{Action: "ai_command_" + outcome, TargetType: "session", TargetID: fmt.Sprint(input.SessionID), SessionID: &input.SessionID, Summary: "AI 命令执行审批", Outcome: auditOutcome})
}

func (s *AIService) ListConversations(sessionID int64, limit int) ([]model.AIConversation, error) {
	if limit <= 0 {
		limit = 100
	}
	return store.ListAIConversations(s.db, sessionID, limit)
}

func (s *AIService) ListMessages(conversationID int64) ([]model.AIMessage, error) {
	return store.ListAIMessages(s.db, conversationID)
}

func (s *AIService) DeleteConversation(id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid conversation id")
	}
	return store.DeleteAIConversation(s.db, id)
}
