package store

import (
	"database/sql"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestAIAgentTaskPersistenceAndActiveSessionConstraint(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
	require.NoError(t, err)
	input := model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect host"}
	task, err := CreateAIAgentTask(db, input, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	assert.Equal(t, model.AIAgentTaskPending, task.Status)
	_, err = CreateAIAgentTask(db, input, model.AIAgentEngineNative, "")
	assert.ErrorContains(t, err, "UNIQUE constraint failed")

	require.NoError(t, UpdateAIAgentTaskStatus(db, task.ID, model.AIAgentTaskRunning, "", ""))
	step, err := CreateAIAgentStep(db, model.AIAgentStep{TaskID: task.ID, Sequence: 1, Kind: "tool", ToolName: "ssh.exec", ToolInput: `{"command":"pwd"}`, Risk: model.AICommandRiskReadOnly, ApprovalStatus: model.AIAgentApprovalNotRequired})
	require.NoError(t, err)
	require.NoError(t, UpdateAIAgentStepResult(db, step.ID, `{"stdout":"/tmp"}`, ""))
	require.NoError(t, UpdateAIAgentTaskStatus(db, task.ID, model.AIAgentTaskCompleted, "done", ""))

	loaded, err := GetAIAgentTask(db, task.ID)
	require.NoError(t, err)
	require.NotNil(t, loaded)
	assert.Equal(t, "done", loaded.Result)
	assert.Equal(t, 1, loaded.StepCount)
	require.Len(t, loaded.Steps, 1)
	assert.Equal(t, `{"stdout":"/tmp"}`, loaded.Steps[0].ToolOutput)
}

func TestAIAgentApprovalInterruptionAndResume(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
	require.NoError(t, err)
	task, err := CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "change host"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	step, err := CreateAIAgentStep(db, model.AIAgentStep{TaskID: task.ID, Sequence: 1, Kind: "tool", ToolName: "ssh.write_file", Risk: model.AICommandRiskModify, ApprovalStatus: model.AIAgentApprovalPending})
	require.NoError(t, err)
	require.NoError(t, UpdateAIAgentTaskStatus(db, task.ID, model.AIAgentTaskWaitingApproval, "", ""))
	require.NoError(t, ResolveAIAgentStepApproval(db, task.ID, step.ID, false))
	_, err = CreateAIAgentStep(db, model.AIAgentStep{TaskID: task.ID, Sequence: 2, Kind: "tool", ToolName: "ssh.exec", Risk: model.AICommandRiskModify, ApprovalStatus: model.AIAgentApprovalPending})
	require.NoError(t, err)
	require.NoError(t, MarkAIAgentTasksInterrupted(db))
	interrupted, err := GetAIAgentTask(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AIAgentTaskInterrupted, interrupted.Status)

	require.NoError(t, ResumeAIAgentTask(db, task.ID))
	resumed, err := GetAIAgentTask(db, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AIAgentTaskPending, resumed.Status)
	assert.Equal(t, 2, resumed.StepCount)
	require.Len(t, resumed.Steps, 2)
	assert.Equal(t, model.AIAgentApprovalRejected, resumed.Steps[1].ApprovalStatus)
	assert.Equal(t, "应用中断，工具未执行", resumed.Steps[1].ToolOutput)
}

func TestLoadAISettingsPreservesAgentDefaultsForLegacyJSON(t *testing.T) {
	db := setupTestDB(t)
	_, err := db.Exec(`INSERT INTO ai_settings (id, interaction_json, search_json, security_json) VALUES (1, '{"panel_width":420,"context_lines":80,"include_session_metadata":true,"include_system_summary":true,"stream_responses":true,"auto_scroll":true,"render_markdown":true,"history_retention_days":30,"max_conversations":100}', '{"enabled":false,"mode":"auto","provider":"brave","timeout_seconds":10,"max_results":5,"require_citations":true}', '{"auto_execute_read_only":false,"command_timeout_seconds":60,"max_output_bytes":65536,"max_plan_steps":5,"allow_patterns":[],"deny_patterns":[],"redaction_patterns":[]}')`)
	require.NoError(t, err)
	defaults := model.AISettings{Interaction: model.AIInteractionSettings{Agent: model.AIAgentSettings{DefaultEngine: model.AIAgentEngineNative, DefaultCLI: model.AIAgentCLICodex}}}
	settings, err := LoadAISettings(db, defaults)
	require.NoError(t, err)
	assert.Equal(t, model.AIAgentEngineNative, settings.Interaction.Agent.DefaultEngine)
	assert.Equal(t, model.AIAgentCLICodex, settings.Interaction.Agent.DefaultCLI)
}

func TestAIAgentTaskListsAndMissingRecords(t *testing.T) {
	db := setupTestDB(t)
	firstSession, err := CreateSession(db, model.Session{Name: "first", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
	require.NoError(t, err)
	secondSession, err := CreateSession(db, model.Session{Name: "second", Host: "127.0.0.2", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
	require.NoError(t, err)
	first, err := CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: firstSession.ID, Prompt: "first"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	require.NoError(t, UpdateAIAgentTaskStatus(db, first.ID, model.AIAgentTaskCompleted, "done", ""))
	second, err := CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: firstSession.ID, Prompt: "second"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	third, err := CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: secondSession.ID, Prompt: "third"}, model.AIAgentEngineLocalCLI, model.AIAgentCLIClaude)
	require.NoError(t, err)
	pendingStep, err := CreateAIAgentStep(db, model.AIAgentStep{TaskID: second.ID, Sequence: 1, Kind: "tool", ToolName: "ssh.exec", Risk: model.AICommandRiskModify, ApprovalStatus: model.AIAgentApprovalPending})
	require.NoError(t, err)

	tasks, err := ListAIAgentTasks(db, 0, 2)
	require.NoError(t, err)
	require.Len(t, tasks, 2)
	assert.Equal(t, third.ID, tasks[0].ID)
	assert.Equal(t, second.ID, tasks[1].ID)
	require.Len(t, tasks[1].Steps, 1)
	assert.Equal(t, pendingStep.ID, tasks[1].Steps[0].ID)
	assert.Equal(t, model.AIAgentApprovalPending, tasks[1].Steps[0].ApprovalStatus)
	tasks, err = ListAIAgentTasks(db, firstSession.ID, 10)
	require.NoError(t, err)
	require.Len(t, tasks, 2)
	assert.Equal(t, second.ID, tasks[0].ID)
	assert.Equal(t, first.ID, tasks[1].ID)
	require.Len(t, tasks[0].Steps, 1)
	assert.Equal(t, pendingStep.ID, tasks[0].Steps[0].ID)

	missingTask, err := GetAIAgentTask(db, third.ID+100)
	require.NoError(t, err)
	assert.Nil(t, missingTask)
	missingStep, err := GetAIAgentStep(db, 100)
	require.NoError(t, err)
	assert.Nil(t, missingStep)
	steps, err := ListAIAgentSteps(db, third.ID)
	require.NoError(t, err)
	assert.Empty(t, steps)
}

func TestAIAgentStoreRejectsInvalidStateTransitions(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
	require.NoError(t, err)
	task, err := CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	step, err := CreateAIAgentStep(db, model.AIAgentStep{TaskID: task.ID, Sequence: 1, Kind: "tool", ToolName: "ssh.write_file", Risk: model.AICommandRiskModify, ApprovalStatus: model.AIAgentApprovalPending})
	require.NoError(t, err)

	assert.ErrorContains(t, ResumeAIAgentTask(db, task.ID), "interrupted")
	assert.ErrorContains(t, UpdateAIAgentTaskStatus(db, task.ID+100, model.AIAgentTaskFailed, "", "missing"), "not found")
	require.NoError(t, ResolveAIAgentStepApproval(db, task.ID, step.ID, true))
	assert.ErrorContains(t, ResolveAIAgentStepApproval(db, task.ID, step.ID, false), "not found")
	assert.ErrorContains(t, UpdateAIAgentStepResult(db, step.ID+100, "", "missing"), "not found")

	parsed, err := parseOptionalAIAgentTime(sql.NullString{})
	require.NoError(t, err)
	assert.Nil(t, parsed)
	parsed, err = parseOptionalAIAgentTime(sql.NullString{String: "2026-01-02 03:04:05", Valid: true})
	require.NoError(t, err)
	assert.Equal(t, 2026, parsed.Year())
	_, err = parseOptionalAIAgentTime(sql.NullString{String: "invalid", Valid: true})
	assert.ErrorContains(t, err, "parse AI agent task time")
	assert.True(t, isAIAgentTerminalStatus(model.AIAgentTaskCompleted))
	assert.True(t, isAIAgentTerminalStatus(model.AIAgentTaskFailed))
	assert.True(t, isAIAgentTerminalStatus(model.AIAgentTaskCancelled))
	assert.True(t, isAIAgentTerminalStatus(model.AIAgentTaskInterrupted))
	assert.False(t, isAIAgentTerminalStatus(model.AIAgentTaskRunning))
	assert.WithinDuration(t, time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), *parsed, 0)
}
