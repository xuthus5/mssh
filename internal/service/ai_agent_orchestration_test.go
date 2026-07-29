package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestRunLocalCLIAgentThroughScopedMCP(t *testing.T) {
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{
		Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30,
	})
	require.NoError(t, err)
	task, err := store.CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "finish"}, model.AIAgentEngineLocalCLI, model.AIAgentCLIOpenCode)
	require.NoError(t, err)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	execution := &aiAgentExecution{cancel: cancel, done: ctx.Done(), approvals: make(map[int64]chan bool)}

	installFakeOpenCode(t)
	result, err := service.runLocalCLIAgent(ctx, *task, execution, &aiAgentSSH{}, defaultAISettings())
	require.NoError(t, err)
	assert.Equal(t, "helper complete", result)
	loaded, err := store.GetAIAgentTask(db, task.ID)
	require.NoError(t, err)
	require.Len(t, loaded.Steps, 1)
	assert.Equal(t, "task.finish", loaded.Steps[0].ToolName)

	t.Setenv("MSSH_AGENT_HELPER_NO_FINISH", "1")
	_, err = service.runLocalCLIAgent(ctx, *task, execution, &aiAgentSSH{}, defaultAISettings())
	assert.ErrorContains(t, err, "without calling task.finish")
}

func installFakeOpenCode(t *testing.T) {
	t.Helper()
	testBinary, err := os.Executable()
	require.NoError(t, err)
	binDir := t.TempDir()
	scriptPath := filepath.Join(binDir, "opencode")
	script := "#!/bin/sh\nexec \"$MSSH_TEST_BINARY\" -test.run=TestAIAgentFakeOpenCodeProcess -- \"$@\"\n"
	require.NoError(t, os.WriteFile(scriptPath, []byte(script), 0o700))
	t.Setenv("MSSH_TEST_BINARY", testBinary)
	t.Setenv("MSSH_AGENT_HELPER_PROCESS", "1")
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestAIAgentFakeOpenCodeProcess(t *testing.T) {
	if os.Getenv("MSSH_AGENT_HELPER_PROCESS") != "1" {
		return
	}
	if os.Getenv("MSSH_AGENT_HELPER_NO_FINISH") != "1" {
		callFakeOpenCodeMCP(t)
	}
	_, err := fmt.Println(`{"type":"assistant","message":"done"}`)
	require.NoError(t, err)
	os.Exit(0)
}

func callFakeOpenCodeMCP(t *testing.T) {
	t.Helper()
	data, err := os.ReadFile(os.Getenv("OPENCODE_CONFIG"))
	require.NoError(t, err)
	var config struct {
		MCP map[string]struct {
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
		} `json:"mcp"`
	}
	require.NoError(t, json.Unmarshal(data, &config))
	mcp := config.MCP["mssh"]
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"task.finish","arguments":{"result":"helper complete"}}}`)
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, mcp.URL, bytes.NewReader(body))
	require.NoError(t, err)
	request.Header.Set("Authorization", mcp.Headers["Authorization"])
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer func() { require.NoError(t, response.Body.Close()) }()
	result, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	assert.Contains(t, string(result), "helper complete")
}

func TestStartAndResumeAIAgentTaskPersistConnectionFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{
		Name: "unreachable", Host: "127.0.0.1", Port: 1, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 1,
	})
	require.NoError(t, err)
	bus := &threadSafeAIAgentBus{}
	sessions := NewSessionService(db, bus, 1, t.TempDir(), nil, testutil.NewTestLogger())
	service := NewAIService(db, nil, nil, testutil.NewTestLogger(), WithAIAgentRuntime(sessions, bus))
	t.Cleanup(service.Shutdown)

	_, err = service.StartAgentTask(model.AIAgentTaskInput{SessionID: session.ID, Prompt: " "})
	assert.ErrorContains(t, err, "required")
	started, err := service.StartAgentTask(model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect"})
	require.NoError(t, err)
	waitForAIAgentStatus(t, service, started.ID, model.AIAgentTaskFailed)
	require.Eventually(t, func() bool { return service.agentExecution(started.ID) == nil }, 3*time.Second, 10*time.Millisecond)
	failed, err := service.GetAgentTask(started.ID)
	require.NoError(t, err)
	assert.Contains(t, strings.ToLower(failed.Error), "connect")
	assert.Contains(t, bus.Names(), "ai:agent-task-changed")

	require.NoError(t, store.UpdateAIAgentTaskStatus(db, started.ID, model.AIAgentTaskInterrupted, "", "interrupted"))
	resumed, err := service.ResumeAgentTask(started.ID)
	require.NoError(t, err)
	assert.Equal(t, model.AIAgentTaskRunning, resumed.Status)
	waitForAIAgentStatus(t, service, started.ID, model.AIAgentTaskFailed)
	require.Eventually(t, func() bool { return service.agentExecution(started.ID) == nil }, 3*time.Second, 10*time.Millisecond)

	local := model.AIAgentEngineLocalCLI
	codex := model.AIAgentCLICodex
	_, err = service.StartAgentTask(model.AIAgentTaskInput{SessionID: session.ID, Prompt: "inspect", Engine: &local, CLI: &codex})
	assert.ErrorContains(t, err, "cannot prove local shell isolation")

	assert.Error(t, service.launchAIAgentTask(started.ID+1000))
	existing := &aiAgentExecution{cancel: func() {}, approvals: make(map[int64]chan bool)}
	service.agent.tasks[started.ID] = existing
	assert.ErrorContains(t, service.launchAIAgentTask(started.ID), "already running")
	service.removeAIAgentExecution(started.ID)
}

func waitForAIAgentStatus(t *testing.T, service *AIService, taskID int64, status model.AIAgentTaskStatus) {
	t.Helper()
	require.Eventually(t, func() bool {
		task, err := service.GetAgentTask(taskID)
		return err == nil && task.Status == status
	}, 3*time.Second, 10*time.Millisecond)
}

type threadSafeAIAgentBus struct {
	mu    sync.Mutex
	names []string
}

func (bus *threadSafeAIAgentBus) Emit(name string, _ interface{}) {
	bus.mu.Lock()
	bus.names = append(bus.names, name)
	bus.mu.Unlock()
}

func (bus *threadSafeAIAgentBus) Names() []string {
	bus.mu.Lock()
	defer bus.mu.Unlock()
	return append([]string(nil), bus.names...)
}
