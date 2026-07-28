package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const maxAICommandBytes = 32 * 1024

func (s *AIService) ExecuteCommand(input model.AICommandExecutionInput) error {
	operationContext, finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if input.SessionID <= 0 {
		return fmt.Errorf("invalid session id")
	}
	if strings.TrimSpace(input.TerminalID) == "" {
		return fmt.Errorf("invalid terminal id")
	}
	if err := s.validateAITarget(input.ConversationID, input.SessionID, input.TerminalID); err != nil {
		return err
	}
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
	if s.terminals == nil {
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
	if err := writeTerminalWithContext(operationContext, s.terminals, input.TerminalID, command, timeout); err != nil {
		s.recordAIExecution(input, proposal.Risk, "failed", err.Error())
		return fmt.Errorf("execute AI command: %w", err)
	}
	s.recordAIExecution(input, proposal.Risk, "success", "")
	return nil
}

func writeTerminalWithTimeout(writer terminalCommandWriter, terminalID, command string, timeout time.Duration) error {
	return writeTerminalWithContext(context.Background(), writer, terminalID, command, timeout)
}

func writeTerminalWithContext(ctx context.Context, writer terminalCommandWriter, terminalID, command string, timeout time.Duration) error {
	if ctx == nil {
		ctx = context.Background()
	}
	done := make(chan error, 1)
	go func() {
		_, err := writer.Write(terminalID, command)
		done <- err
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case writeErr := <-done:
		return writeErr
	case <-ctx.Done():
		abortErr := fmt.Errorf("terminal write canceled: %w; terminal close requested and command outcome is unknown", ctx.Err())
		return abortTerminalWrite(writer, terminalWriteAbortRequest{
			terminalID: terminalID, done: done, phase: "cancellation", abortErr: abortErr,
		})
	case <-timer.C:
		select {
		case writeErr := <-done:
			return writeErr
		default:
		}
		timeoutErr := fmt.Errorf("terminal write timed out after %s; terminal close requested and command outcome is unknown", timeout)
		return abortTerminalWrite(writer, terminalWriteAbortRequest{
			terminalID: terminalID, done: done, phase: "timeout", abortErr: timeoutErr,
		})
	}
}

var terminalWriteAbortWait = 500 * time.Millisecond

type terminalWriteAbortRequest struct {
	terminalID string
	done       <-chan error
	phase      string
	abortErr   error
}

type terminalWriteAbortResult struct {
	closeFinished bool
	writeFinished bool
	closeErr      error
	writeErr      error
}

type terminalWriteAbortState struct {
	closeDone <-chan error
	writeDone <-chan error
	result    terminalWriteAbortResult
}

func abortTerminalWrite(writer terminalCommandWriter, request terminalWriteAbortRequest) error {
	state := terminalWriteAbortState{
		closeDone: startTerminalClose(writer, request.terminalID), writeDone: request.done,
	}
	timer := time.NewTimer(terminalWriteAbortWait)
	defer timer.Stop()
	for state.pending() {
		select {
		case closeErr := <-state.closeDone:
			state.acceptClose(closeErr)
		case writeErr := <-state.writeDone:
			state.acceptWrite(writeErr)
		case <-timer.C:
			state.drainReady()
			return state.result.joinError(request)
		}
	}
	return state.result.joinError(request)
}

func startTerminalClose(writer terminalCommandWriter, terminalID string) <-chan error {
	closeDone := make(chan error, 1)
	go func() { closeDone <- writer.Close(terminalID) }()
	return closeDone
}

func (state terminalWriteAbortState) pending() bool {
	return state.closeDone != nil || state.writeDone != nil
}

func (state *terminalWriteAbortState) acceptClose(err error) {
	state.result.closeFinished = true
	state.result.closeErr = err
	state.closeDone = nil
}

func (state *terminalWriteAbortState) acceptWrite(err error) {
	state.result.writeFinished = true
	state.result.writeErr = err
	state.writeDone = nil
}

func (state *terminalWriteAbortState) drainReady() {
	if state.closeDone != nil {
		select {
		case err := <-state.closeDone:
			state.acceptClose(err)
		default:
		}
	}
	if state.writeDone != nil {
		select {
		case err := <-state.writeDone:
			state.acceptWrite(err)
		default:
		}
	}
}

func (result terminalWriteAbortResult) joinError(request terminalWriteAbortRequest) error {
	abortErr := request.abortErr
	if result.closeFinished && result.closeErr != nil {
		abortErr = errors.Join(abortErr, fmt.Errorf("close terminal after write %s: %w", request.phase, result.closeErr))
	}
	if result.writeFinished && result.writeErr != nil {
		abortErr = errors.Join(abortErr, fmt.Errorf("terminal write ended after %s: %w", request.phase, result.writeErr))
	}
	if !result.closeFinished {
		abortErr = errors.Join(abortErr, fmt.Errorf("terminal close did not finish after write %s", request.phase))
	}
	if !result.writeFinished {
		abortErr = errors.Join(abortErr, fmt.Errorf("terminal write did not stop after %s", request.phase))
	}
	return abortErr
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
	_, finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if sessionID <= 0 {
		return nil, fmt.Errorf("invalid session id")
	}
	if limit <= 0 {
		limit = 100
	}
	return store.ListAIConversations(s.db, sessionID, limit)
}

func (s *AIService) ListMessages(conversationID int64) ([]model.AIMessage, error) {
	_, finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if conversationID <= 0 {
		return nil, fmt.Errorf("invalid conversation id")
	}
	return store.ListAIMessages(s.db, conversationID)
}

func (s *AIService) DeleteConversation(id int64) error {
	_, finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if id <= 0 {
		return fmt.Errorf("invalid conversation id")
	}
	return store.DeleteAIConversation(s.db, id)
}
