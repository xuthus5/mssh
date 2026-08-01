package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestAIAgentTaskQueryAndValidationAPI(t *testing.T) {
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{
		Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30,
	})
	require.NoError(t, err)
	sessions := NewSessionService(db, nil, 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewAIService(db, nil, nil, testutil.NewTestLogger(), WithAIAgentRuntime(sessions, nil))
	task, err := store.CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)

	tasks, err := service.ListAgentTasks(0, 0)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Equal(t, task.ID, tasks[0].ID)
	tasks, err = service.ListAgentTasks(session.ID, 1)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	_, err = service.ListAgentTasks(-1, 1)
	assert.ErrorContains(t, err, "invalid session")
	_, err = service.ListAgentTasks(0, maxAIAgentTaskLimit+1)
	assert.ErrorContains(t, err, "must not exceed")

	loaded, err := service.GetAgentTask(task.ID)
	require.NoError(t, err)
	assert.Equal(t, "inspect", loaded.Prompt)
	_, err = service.GetAgentTask(0)
	assert.ErrorContains(t, err, "invalid")
	_, err = service.GetAgentTask(task.ID + 100)
	assert.ErrorContains(t, err, "not found")

	input := model.AIAgentTaskInput{SessionID: session.ID, Prompt: "  inspect host  "}
	require.NoError(t, service.validateAIAgentTaskInput(&input))
	assert.Equal(t, "inspect host", input.Prompt)
	input = model.AIAgentTaskInput{SessionID: session.ID, Prompt: strings.Repeat("x", maxAIAgentPromptBytes+1)}
	assert.ErrorContains(t, service.validateAIAgentTaskInput(&input), "too large")
	input = model.AIAgentTaskInput{SessionID: session.ID, Prompt: " "}
	assert.ErrorContains(t, service.validateAIAgentTaskInput(&input), "required")
	input = model.AIAgentTaskInput{SessionID: session.ID + 100, Prompt: "inspect"}
	assert.Error(t, service.validateAIAgentTaskInput(&input))
	service.sessions = nil
	input = model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect"}
	assert.ErrorContains(t, service.validateAIAgentTaskInput(&input), "unavailable")
}

func TestDeleteAgentTaskRemovesTaskAndSteps(t *testing.T) {
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{
		Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30,
	})
	require.NoError(t, err)
	sessions := NewSessionService(db, nil, 30, t.TempDir(), nil, testutil.NewTestLogger())
	bus := newMockEventBus()
	service := NewAIService(db, nil, nil, testutil.NewTestLogger(), WithAIAgentRuntime(sessions, bus))
	task, err := store.CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	step, err := store.CreateAIAgentStep(db, model.AIAgentStep{TaskID: task.ID, Sequence: 1, Kind: "tool", ToolName: "ssh.exec", Risk: model.AICommandRiskReadOnly, ApprovalStatus: model.AIAgentApprovalNotRequired})
	require.NoError(t, err)

	require.NoError(t, service.DeleteAgentTask(task.ID))

	loaded, err := service.GetAgentTask(task.ID)
	assert.Nil(t, loaded)
	assert.ErrorContains(t, err, "not found")
	loadedStep, err := store.GetAIAgentStep(db, step.ID)
	require.NoError(t, err)
	require.Nil(t, loadedStep)
	assert.True(t, bus.hasEvent(event.AIAgentTaskChanged))
	missing, err := store.GetAIAgentTask(db, task.ID)
	require.NoError(t, err)
	require.Nil(t, missing)
	assert.ErrorContains(t, service.DeleteAgentTask(task.ID), "not found")
	assert.ErrorContains(t, service.DeleteAgentTask(0), "invalid")
}

func TestDeleteAgentTaskCancelsActiveExecution(t *testing.T) {
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{
		Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30,
	})
	require.NoError(t, err)
	sessions := NewSessionService(db, nil, 30, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewAIService(db, nil, nil, testutil.NewTestLogger(), WithAIAgentRuntime(sessions, nil))
	task, err := store.CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	service.agent.tasks = make(map[int64]*aiAgentExecution)
	service.agent.tasks[task.ID] = &aiAgentExecution{cancel: cancel, done: ctx.Done(), approvals: make(map[int64]chan bool)}
	go func() {
		<-ctx.Done()
		service.removeAIAgentExecution(task.ID)
	}()

	require.NoError(t, service.DeleteAgentTask(task.ID))

	require.Nil(t, service.agentExecution(task.ID))
	loaded, err := service.GetAgentTask(task.ID)
	assert.Nil(t, loaded)
	assert.ErrorContains(t, err, "not found")
}

func TestAIAgentRuntimeStateAndResumeGuards(t *testing.T) {
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{
		Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30,
	})
	require.NoError(t, err)
	task, err := store.CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())

	var cancelled atomic.Bool
	execution := &aiAgentExecution{cancel: func() { cancelled.Store(true) }, approvals: make(map[int64]chan bool)}
	service.agent.tasks = map[int64]*aiAgentExecution{task.ID: execution}
	require.NoError(t, service.CancelAgentTask(task.ID))
	assert.True(t, cancelled.Load())
	assert.Same(t, execution, service.agentExecution(task.ID))
	service.removeAIAgentExecution(task.ID)
	assert.Nil(t, service.agentExecution(task.ID))
	assert.ErrorContains(t, service.CancelAgentTask(task.ID), "not active")
	assert.False(t, service.aiAgentStopping())
	service.agent.stopping = true
	assert.True(t, service.aiAgentStopping())

	_, err = service.ResumeAgentTask(0)
	assert.ErrorContains(t, err, "invalid")
	_, err = service.ResumeAgentTask(task.ID + 100)
	assert.ErrorContains(t, err, "not found")
	for sequence := 1; sequence <= defaultAISettings().Security.MaxPlanSteps; sequence++ {
		_, err = store.CreateAIAgentStep(db, model.AIAgentStep{
			TaskID: task.ID, Sequence: sequence, Kind: "tool", ToolName: "ssh.stat",
			Risk: model.AICommandRiskReadOnly, ApprovalStatus: model.AIAgentApprovalNotRequired,
		})
		require.NoError(t, err)
	}
	require.NoError(t, store.MarkAIAgentTasksInterrupted(db))
	_, err = service.ResumeAgentTask(task.ID)
	assert.ErrorContains(t, err, "maximum")

	uniqueErr := normalizeAIAgentTaskCreateError(assert.AnError)
	assert.ErrorIs(t, uniqueErr, assert.AnError)
	uniqueErr = normalizeAIAgentTaskCreateError(assert.AnError)
	assert.NotNil(t, uniqueErr)
	assert.ErrorContains(t, normalizeAIAgentTaskCreateError(&testAgentError{"UNIQUE constraint failed"}), "already has")
}

type testAgentError struct{ message string }

func (err *testAgentError) Error() string { return err.message }

func TestAIAgentHistoryFinishAndAuthorization(t *testing.T) {
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{
		Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30,
	})
	require.NoError(t, err)
	task, err := store.CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	security := defaultAISettings().Security

	history := aiAgentHistoryFromSteps([]model.AIAgentStep{
		{ToolName: "ssh.stat", ToolInput: `{"path":"/tmp"}`, ToolOutput: "ok"},
		{ToolName: "ssh.exec", ToolInput: `{"command":"false"}`, ToolOutput: "output", Error: "failed"},
	})
	require.Len(t, history, 2)
	assert.Equal(t, "error: failed\noutput", history[1].Result)
	prompt, err := buildAIAgentPrompt(*task, history)
	require.NoError(t, err)
	assert.Contains(t, prompt, "inspect")

	result, finished, err := service.performAIAgentAction(context.Background(), task.ID, 1, aiAgentAction{
		Tool: "task.finish", Arguments: []byte(`{"result":"done"}`), Reason: "complete",
	}, &aiAgentExecution{}, nil, security)
	require.NoError(t, err)
	assert.True(t, finished)
	assert.Equal(t, "done", result)
	_, _, err = service.performAIAgentAction(context.Background(), task.ID, 2, aiAgentAction{Tool: "unknown", Arguments: []byte(`{}`)}, &aiAgentExecution{}, nil, security)
	assert.ErrorContains(t, err, "unsupported")

	step, err := store.CreateAIAgentStep(db, model.AIAgentStep{
		TaskID: task.ID, Sequence: 3, Kind: "tool", ToolName: "ssh.exec",
		Risk: model.AICommandRiskHigh, ApprovalStatus: model.AIAgentApprovalNotRequired,
	})
	require.NoError(t, err)
	proceed, response, err := service.authorizeAIAgentTool(context.Background(), step, aiAgentToolRequest{Blocked: "dangerous"}, &aiAgentExecution{})
	require.NoError(t, err)
	assert.False(t, proceed)
	assert.Equal(t, "blocked: dangerous", response)

	step, err = store.CreateAIAgentStep(db, model.AIAgentStep{
		TaskID: task.ID, Sequence: 4, Kind: "tool", ToolName: "ssh.stat",
		Risk: model.AICommandRiskReadOnly, ApprovalStatus: model.AIAgentApprovalNotRequired,
	})
	require.NoError(t, err)
	proceed, _, err = service.authorizeAIAgentTool(context.Background(), step, aiAgentToolRequest{}, &aiAgentExecution{})
	require.NoError(t, err)
	assert.True(t, proceed)

	output, finished, err := service.executeAIAgentTool(context.Background(), step, aiAgentToolRequest{Name: "unknown", Timeout: 1}, &aiAgentSSH{}, security)
	require.NoError(t, err)
	assert.False(t, finished)
	assert.Contains(t, output, "unsupported")
	assert.ErrorContains(t, decodeAIAgentArguments([]byte(`{"value":1,"extra":2}`), &struct {
		Value int `json:"value"`
	}{}), "unknown field")
}

func TestAIAgentMCPProtocolBranches(t *testing.T) {
	service, bridge := newAIAgentMCPFixture(t)
	tests := []struct {
		name       string
		method     string
		auth       bool
		body       string
		statusCode int
		contains   string
	}{
		{name: "method", method: http.MethodGet, auth: true, statusCode: http.StatusMethodNotAllowed, contains: "method not allowed"},
		{name: "unauthorized", method: http.MethodPost, body: `{}`, statusCode: http.StatusUnauthorized, contains: "unauthorized"},
		{name: "invalid JSON", method: http.MethodPost, auth: true, body: `{`, statusCode: http.StatusOK, contains: "invalid JSON-RPC request"},
		{name: "initialize", method: http.MethodPost, auth: true, body: `{"jsonrpc":"2.0","id":1,"method":"initialize"}`, statusCode: http.StatusOK, contains: aiAgentMCPProtocolVersion},
		{name: "initialized", method: http.MethodPost, auth: true, body: `{"jsonrpc":"2.0","method":"notifications/initialized"}`, statusCode: http.StatusAccepted},
		{name: "ping", method: http.MethodPost, auth: true, body: `{"jsonrpc":"2.0","id":1,"method":"ping"}`, statusCode: http.StatusOK, contains: `"result"`},
		{name: "unknown", method: http.MethodPost, auth: true, body: `{"jsonrpc":"2.0","id":1,"method":"unknown"}`, statusCode: http.StatusOK, contains: "method not found"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, "/mcp", strings.NewReader(test.body))
			if test.auth {
				request.Header.Set("Authorization", "Bearer secret")
			}
			response := httptest.NewRecorder()
			bridge.serveHTTP(response, request)
			assert.Equal(t, test.statusCode, response.Code)
			assert.Contains(t, response.Body.String(), test.contains)
		})
	}

	call := func(body string) string {
		request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer secret")
		response := httptest.NewRecorder()
		bridge.serveHTTP(response, request)
		return response.Body.String()
	}
	assert.Contains(t, call(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":[]}`), "invalid tool parameters")
	assert.Contains(t, call(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"task.finish","arguments":{"result":"done"}}}`), "done")
	assert.True(t, bridge.finished)
	assert.Contains(t, call(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"task.finish","arguments":{"result":"again"}}}`), "already finished")

	bridge.finished = false
	bridge.sequence = bridge.security.MaxPlanSteps
	assert.Contains(t, call(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"task.finish","arguments":{"result":"late"}}}`), "maximum step count")
	bridge.sequence = 0
	assert.Contains(t, call(`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"browser","arguments":{}}}`), `"isError":true`)
	assert.Equal(t, context.Background(), bridge.actionContext())
	service.emitAIAgentTask(0)
	service.emitAIAgentStep(0, 0)
}

func newAIAgentMCPFixture(t *testing.T) (*AIService, *aiAgentMCPBridge) {
	t.Helper()
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{
		Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30,
	})
	require.NoError(t, err)
	task, err := store.CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect"}, model.AIAgentEngineLocalCLI, model.AIAgentCLIClaude)
	require.NoError(t, err)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	done := make(chan struct{})
	execution := &aiAgentExecution{cancel: func() {}, done: done, approvals: make(map[int64]chan bool)}
	return service, &aiAgentMCPBridge{
		service: service, task: *task, execution: execution,
		security: defaultAISettings().Security, token: "secret",
	}
}

type recordingAIAgentBus struct{ events []string }

func (bus *recordingAIAgentBus) Emit(name string, _ interface{}) {
	bus.events = append(bus.events, name)
}

func TestAIAgentEventsEmitPersistedPayloads(t *testing.T) {
	service, bridge := newAIAgentMCPFixture(t)
	bus := &recordingAIAgentBus{}
	service.eventBus = bus
	service.emitAIAgentTask(bridge.task.ID)
	_, _, err := service.finishAIAgentTask(bridge.task.ID, 1, aiAgentAction{Tool: "task.finish", Arguments: json.RawMessage(`{"result":"done"}`)}, bridge.security)
	require.NoError(t, err)
	assert.Contains(t, bus.events, event.AIAgentTaskChanged)
	assert.Contains(t, bus.events, event.AIAgentStepChanged)
}
