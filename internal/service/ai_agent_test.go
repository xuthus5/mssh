package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	msshssh "github.com/xuthus5/mssh/internal/ssh"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestResolveAIAgentSelection(t *testing.T) {
	local := model.AIAgentEngineLocalCLI
	claude := model.AIAgentCLIClaude
	tests := []struct {
		name   string
		input  model.AIAgentTaskInput
		engine model.AIAgentEngine
		cli    model.AIAgentCLI
	}{
		{name: "defaults native", engine: model.AIAgentEngineNative},
		{name: "overrides local CLI", input: model.AIAgentTaskInput{Engine: &local, CLI: &claude}, engine: local, cli: claude},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			engine, cli, err := resolveAIAgentSelection(test.input, model.AIAgentSettings{DefaultEngine: model.AIAgentEngineNative, DefaultCLI: model.AIAgentCLICodex})
			require.NoError(t, err)
			assert.Equal(t, test.engine, engine)
			assert.Equal(t, test.cli, cli)
		})
	}
}

func TestPrepareAIAgentToolRequestSecurity(t *testing.T) {
	security := defaultAISettings().Security
	security.AutoExecuteReadOnly = true
	request, err := prepareAIAgentToolRequest(aiAgentAction{Tool: "ssh.exec", Arguments: json.RawMessage(`{"command":"pwd"}`)}, security)
	require.NoError(t, err)
	assert.Equal(t, model.AICommandRiskReadOnly, request.Risk)
	assert.Equal(t, model.AIAgentApprovalNotRequired, request.Approval)

	request, err = prepareAIAgentToolRequest(aiAgentAction{Tool: "ssh.exec", Arguments: json.RawMessage(`{"command":"touch /tmp/a"}`)}, security)
	require.NoError(t, err)
	assert.Equal(t, model.AIAgentApprovalPending, request.Approval)

	request, err = prepareAIAgentToolRequest(aiAgentAction{Tool: "ssh.exec", Arguments: json.RawMessage(`{"command":"rm -rf /"}`)}, security)
	require.NoError(t, err)
	assert.NotEmpty(t, request.Blocked)

	_, err = prepareAIAgentToolRequest(aiAgentAction{Tool: "ssh.read_file", Arguments: json.RawMessage(`{"path":"relative"}`)}, security)
	assert.ErrorContains(t, err, "absolute")
}

func TestParseAIAgentActionStrictJSON(t *testing.T) {
	action, err := parseAIAgentAction("```json\n{\"tool\":\"task.finish\",\"arguments\":{\"result\":\"done\"},\"reason\":\"ok\"}\n```")
	require.NoError(t, err)
	assert.Equal(t, "task.finish", action.Tool)
	_, err = parseAIAgentAction(`{"tool":"task.finish","arguments":{},"unknown":true}`)
	assert.Error(t, err)
}

func TestAIAgentMCPRequiresTokenAndListsScopedTools(t *testing.T) {
	service := NewAIService(testutil.NewTestDB(t), nil, nil, testutil.NewTestLogger())
	bridge := &aiAgentMCPBridge{service: service, task: model.AIAgentTask{ID: 7}, security: defaultAISettings().Security, token: "secret"}
	server := httptest.NewServer(http.HandlerFunc(bridge.serveHTTP))
	t.Cleanup(server.Close)
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`)
	response, err := http.Post(server.URL, "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, response.StatusCode)
	require.NoError(t, response.Body.Close())

	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, server.URL, bytes.NewReader(body))
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer secret")
	response, err = http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer func() { require.NoError(t, response.Body.Close()) }()
	var result map[string]any
	require.NoError(t, json.NewDecoder(response.Body).Decode(&result))
	assert.Contains(t, string(mustAIAgentJSON(t, result)), "ssh.exec")
	assert.Contains(t, string(mustAIAgentJSON(t, result)), "task.finish")
}

func TestAIAgentCLIAdaptersFailClosed(t *testing.T) {
	_, err := newAIAgentCLIAdapter(model.AIAgentCLICodex)
	assert.ErrorContains(t, err, "cannot prove local shell isolation")
	_, err = newAIAgentCLIAdapter("unknown")
	assert.Error(t, err)
}

func TestAIAgentDefaultAvailabilityFailsClosed(t *testing.T) {
	assert.NoError(t, validateAIAgentDefaultAvailability(model.AIAgentSettings{DefaultEngine: model.AIAgentEngineNative, DefaultCLI: model.AIAgentCLICodex}))
	err := validateAIAgentDefaultAvailability(model.AIAgentSettings{DefaultEngine: model.AIAgentEngineLocalCLI, DefaultCLI: model.AIAgentCLICodex})
	assert.ErrorContains(t, err, "cannot prove local shell isolation")
}

func TestLimitAIAgentDirectoryEntriesPreservesJSONEnvelope(t *testing.T) {
	entries := []msshssh.FileEntry{{Name: "one", Path: "/tmp/one"}, {Name: strings.Repeat("x", 200), Path: "/tmp/two"}}
	limited, truncated, err := limitAIAgentDirectoryEntries(entries, 128)
	require.NoError(t, err)
	assert.True(t, truncated)
	require.Len(t, limited, 1)
	data, err := json.Marshal(map[string]any{"entries": limited, "truncated": truncated})
	require.NoError(t, err)
	assert.LessOrEqual(t, len(data), 128)
}

func TestAIAgentCLIEventsRejectLocalTools(t *testing.T) {
	assert.NoError(t, claudeAIAgentAdapter{}.ValidateEvent([]byte(`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__mssh__ssh.exec"}]}}`)))
	assert.ErrorContains(t, claudeAIAgentAdapter{}.ValidateEvent([]byte(`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}`)), "unavailable local tool")
	assert.ErrorContains(t, openCodeAIAgentAdapter{}.ValidateEvent([]byte(`{"type":"tool_use","tool":"bash"}`)), "unavailable local tool")
}

func TestClaudeAIAgentTokenUsesPrivateConfigFile(t *testing.T) {
	binDir := t.TempDir()
	installAIAgentTestLauncher(t, binDir, "claude", "TestAIAgentCLIProcessHelper")
	setAIAgentTestPath(t, binDir)
	workDir := t.TempDir()
	command, err := (claudeAIAgentAdapter{}).Command(workDir, "http://127.0.0.1/mcp", "private-token", "prompt")
	require.NoError(t, err)
	assert.NotContains(t, strings.Join(command.Args, "\x00"), "private-token")
	configPath := filepath.Join(workDir, "claude-mcp.json")
	config, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Contains(t, string(config), "private-token")
	info, err := os.Stat(configPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}

func TestAIAgentApprovalChannelExistsBeforeStepEvent(t *testing.T) {
	db := testutil.NewTestDB(t)
	session, err := store.CreateSession(db, model.Session{Name: "agent", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
	require.NoError(t, err)
	task, err := store.CreateAIAgentTask(db, model.AIAgentTaskInput{SessionID: session.ID, Prompt: "change"}, model.AIAgentEngineNative, "")
	require.NoError(t, err)
	step, err := store.CreateAIAgentStep(db, model.AIAgentStep{TaskID: task.ID, Sequence: 1, Kind: "tool", ToolName: "ssh.write_file", Risk: model.AICommandRiskModify, ApprovalStatus: model.AIAgentApprovalPending})
	require.NoError(t, err)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	execution := &aiAgentExecution{cancel: func() {}, approvals: make(map[int64]chan bool)}
	service.agent.tasks = map[int64]*aiAgentExecution{task.ID: execution}
	bus := &autoApprovingAIAgentBus{service: service, result: make(chan error, 1)}
	service.eventBus = bus
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	approved, err := service.awaitAIAgentApproval(ctx, task.ID, step.ID, execution)
	require.NoError(t, err)
	assert.True(t, approved)
	require.NoError(t, <-bus.result)
}

type autoApprovingAIAgentBus struct {
	service *AIService
	result  chan error
	called  atomic.Bool
}

func (bus *autoApprovingAIAgentBus) Emit(name string, payload interface{}) {
	if name != event.AIAgentStepChanged {
		return
	}
	step, ok := payload.(*model.AIAgentStep)
	if ok && bus.called.CompareAndSwap(false, true) {
		bus.result <- bus.service.ApproveAgentStep(step.TaskID, step.ID, true)
	}
}

func mustAIAgentJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	return data
}
