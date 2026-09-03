package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
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
	_, err := newAIAgentCLIAdapter(model.AIAgentCLICodex, false)
	assert.ErrorContains(t, err, "cannot prove local shell isolation")
	_, err = newAIAgentCLIAdapter(model.AIAgentCLICodex, true)
	assert.NoError(t, err)
	_, err = newAIAgentCLIAdapter("unknown", false)
	assert.Error(t, err)
}

func TestAIAgentDefaultAvailabilityFailsClosed(t *testing.T) {
	assert.NoError(t, validateAIAgentDefaultAvailability(model.AIAgentSettings{DefaultEngine: model.AIAgentEngineNative, DefaultCLI: model.AIAgentCLICodex}))
	err := validateAIAgentDefaultAvailability(model.AIAgentSettings{DefaultEngine: model.AIAgentEngineLocalCLI, DefaultCLI: model.AIAgentCLICodex})
	assert.ErrorContains(t, err, "cannot prove local shell isolation")
	t.Setenv("PATH", t.TempDir())
	err = validateAIAgentDefaultAvailability(model.AIAgentSettings{DefaultEngine: model.AIAgentEngineLocalCLI, DefaultCLI: model.AIAgentCLICodex, AllowCodex: true})
	assert.ErrorContains(t, err, "AI agent CLI codex is unavailable")
}

func TestCodexAIAgentCommandUsesScopedOverridesAndTokenEnv(t *testing.T) {
	binDir := t.TempDir()
	installAIAgentTestLauncher(t, binDir, "codex", "TestAIAgentCLIProcessHelper")
	setAIAgentTestPath(t, binDir)
	codexHome := t.TempDir()
	writeTestCodexModelCatalog(t, codexHome, true)
	workDir := t.TempDir()
	command, err := (codexAIAgentAdapter{codexHome: codexHome}).Command(workDir, "http://127.0.0.1:9/mcp", "private-token", "prompt")
	require.NoError(t, err)
	assert.Equal(t, workDir, command.Dir)
	assert.NotContains(t, strings.Join(command.Args, "\x00"), "private-token")
	assert.Contains(t, command.Env, "MSSH_AGENT_TOKEN=private-token")
	joined := strings.Join(command.Args, "\x00")
	assert.Contains(t, joined, "mcp_servers.mssh.url=")
	assert.Contains(t, joined, `approval_policy="never"`)
	assert.Contains(t, joined, "features.plugins=false")
	assert.Contains(t, joined, "enabled_tools=")
	assert.Contains(t, joined, "model_catalog_json=")
	assert.Equal(t, "-", command.Args[len(command.Args)-1])
	expectedSandbox := "read-only"
	if runtime.GOOS == "windows" {
		expectedSandbox = "danger-full-access"
	}
	assert.Contains(t, joined, `sandbox_mode="`+expectedSandbox+`"`)
	require.NotNil(t, command.Stdin)
	data, err := io.ReadAll(command.Stdin)
	require.NoError(t, err)
	assert.Equal(t, "prompt", string(data))
}

func TestCodexAIAgentCommandSkipsModelCatalogOverrideWhenAbsent(t *testing.T) {
	binDir := t.TempDir()
	installAIAgentTestLauncher(t, binDir, "codex", "TestAIAgentCLIProcessHelper")
	setAIAgentTestPath(t, binDir)
	command, err := (codexAIAgentAdapter{codexHome: t.TempDir()}).Command(t.TempDir(), "http://127.0.0.1:9/mcp", "private-token", "prompt")
	require.NoError(t, err)
	assert.NotContains(t, strings.Join(command.Args, "\x00"), "model_catalog_json=")
}

func TestCodexAIAgentCommandUsesCODEXHomeEnv(t *testing.T) {
	binDir := t.TempDir()
	installAIAgentTestLauncher(t, binDir, "codex", "TestAIAgentCLIProcessHelper")
	setAIAgentTestPath(t, binDir)
	codexHome := t.TempDir()
	writeTestCodexModelCatalog(t, codexHome, true)
	t.Setenv("CODEX_HOME", codexHome)
	command, err := (codexAIAgentAdapter{}).Command(t.TempDir(), "http://127.0.0.1:9/mcp", "private-token", "prompt")
	require.NoError(t, err)
	assert.Contains(t, strings.Join(command.Args, "\x00"), "model_catalog_json=")
}

func TestPrepareCodexModelCatalogForMCPDisablesSearchTool(t *testing.T) {
	codexHome := t.TempDir()
	writeTestCodexModelCatalog(t, codexHome, true)
	path, err := prepareCodexModelCatalogForMCP(t.TempDir(), codexHome)
	require.NoError(t, err)
	require.NotEmpty(t, path)
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var catalog map[string]any
	require.NoError(t, json.Unmarshal(data, &catalog))
	models, ok := catalog["models"].([]any)
	require.True(t, ok)
	require.Len(t, models, 3)
	first, ok := models[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, false, first["supports_search_tool"])
	assert.Equal(t, float64(1048576), first["context_window"])
	second, ok := models[1].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, false, second["supports_search_tool"])
}

func TestPrepareCodexModelCatalogForMCPHonorsConfigPath(t *testing.T) {
	codexHome := t.TempDir()
	custom := filepath.Join(codexHome, "custom-catalog.json")
	writeTestCodexModelCatalogAt(t, custom, true)
	config := "model = \"deepseek-v4-flash\"\nmodel_catalog_json = \"" + custom + "\"\n"
	require.NoError(t, os.WriteFile(filepath.Join(codexHome, "config.toml"), []byte(config), 0o600))
	path, err := prepareCodexModelCatalogForMCP(t.TempDir(), codexHome)
	require.NoError(t, err)
	assert.NotEmpty(t, path)
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Contains(t, string(data), "supports_search_tool")
}

func TestPrepareCodexModelCatalogForMCPRejectsCatalogOutsideCodexHome(t *testing.T) {
	codexHome := t.TempDir()
	custom := filepath.Join(t.TempDir(), "custom-catalog.json")
	writeTestCodexModelCatalogAt(t, custom, true)
	config := "model_catalog_json = \"" + custom + "\"\n"
	require.NoError(t, os.WriteFile(filepath.Join(codexHome, "config.toml"), []byte(config), 0o600))

	path, err := prepareCodexModelCatalogForMCP(t.TempDir(), codexHome)
	require.NoError(t, err)
	assert.Empty(t, path)
}

func TestPrepareCodexModelCatalogForMCPIgnoresMissingCatalog(t *testing.T) {
	path, err := prepareCodexModelCatalogForMCP(t.TempDir(), t.TempDir())
	require.NoError(t, err)
	assert.Empty(t, path)
}

func TestPrepareCodexModelCatalogForMCPIgnoresInvalidJSON(t *testing.T) {
	codexHome := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(codexHome, "models.json"), []byte("not-json"), 0o600))
	path, err := prepareCodexModelCatalogForMCP(t.TempDir(), codexHome)
	require.NoError(t, err)
	assert.Empty(t, path)
}

func TestPrepareCodexModelCatalogForMCPIgnoresMalformedModels(t *testing.T) {
	codexHome := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(codexHome, "models.json"), []byte(`{"models":{"slug":"x"}}`), 0o600))
	path, err := prepareCodexModelCatalogForMCP(t.TempDir(), codexHome)
	require.NoError(t, err)
	assert.Empty(t, path)
}

func TestPrepareCodexModelCatalogForMCPSkipsWhenSearchToolDisabled(t *testing.T) {
	codexHome := t.TempDir()
	writeTestCodexModelCatalog(t, codexHome, false)
	path, err := prepareCodexModelCatalogForMCP(t.TempDir(), codexHome)
	require.NoError(t, err)
	assert.Empty(t, path)
}

func TestCodexModelCatalogPathFromConfig(t *testing.T) {
	codexHome := t.TempDir()
	assert.Empty(t, codexModelCatalogPathFromConfig(codexHome))
	tests := []struct {
		name   string
		config string
		want   string
	}{
		{name: "double quoted", config: "model_catalog_json = \"C:/x/models.json\"\n", want: "C:/x/models.json"},
		{name: "single quoted", config: "model_catalog_json = 'C:/x/models.json'\n", want: "C:/x/models.json"},
		{name: "not a string", config: "model_catalog_json = 123\n", want: ""},
		{name: "empty value", config: "model_catalog_json =\n", want: ""},
		{name: "unterminated string", config: "model_catalog_json = \"C:/x\n", want: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			home := t.TempDir()
			require.NoError(t, os.WriteFile(filepath.Join(home, "config.toml"), []byte(test.config), 0o600))
			assert.Equal(t, test.want, codexModelCatalogPathFromConfig(home))
		})
	}
}

func writeTestCodexModelCatalog(t *testing.T, codexHome string, searchEnabled bool) {
	t.Helper()
	writeTestCodexModelCatalogAt(t, filepath.Join(codexHome, "models.json"), searchEnabled)
}

func writeTestCodexModelCatalogAt(t *testing.T, path string, searchEnabled bool) {
	t.Helper()
	catalog := map[string]any{
		"models": []any{
			map[string]any{
				"slug":                 "deepseek-v4-flash",
				"supports_search_tool": searchEnabled,
				"context_window":       1048576,
				"base_instructions":    "test",
			},
			map[string]any{
				"slug":                 "plain-model",
				"supports_search_tool": false,
			},
			"not-a-model",
		},
	}
	data, err := json.Marshal(catalog)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, data, 0o600))
}

func TestCodexAIAgentEventsRejectLocalTools(t *testing.T) {
	adapter := codexAIAgentAdapter{}
	assert.NoError(t, adapter.ValidateEvent([]byte(`{"type":"thread.started","thread_id":"1"}`)))
	assert.NoError(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"ok"}}`)))
	assert.NoError(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"mcp_tool_call","server":"mssh","tool":"ssh.exec","status":"completed"}}`)))
	assert.NoError(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","item_type":"mcp_tool_call","server":"mssh","tool":"task.finish"}}`)))
	assert.NoError(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"mcp_tool_call","server":"codex","tool":"list_mcp_resources"}}`)))
	assert.NoError(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"mcp_tool_call","server":"codex","tool":"read_mcp_resource","arguments":{"server":"codex","uri":"codex://x"}}}`)))
	assert.ErrorContains(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"command_execution","command":"bash -lc pwd"}}`)), "unavailable local tool")
	assert.ErrorContains(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"file_change"}}`)), "unavailable local tool")
	assert.ErrorContains(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"web_search"}}`)), "unavailable local tool")
	assert.ErrorContains(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"mcp_tool_call","server":"github","tool":"create_issue"}}`)), "unavailable tool")
	assert.ErrorContains(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"mcp_tool_call","server":"mssh","tool":"read"}}`)), "unavailable tool")
	assert.ErrorContains(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"mcp_tool_call","server":"codex","tool":"unknown_tool"}}`)), "unavailable tool")
	assert.ErrorContains(t, adapter.ValidateEvent([]byte(`{"type":"item.completed","item":{"id":"i","type":"mcp_tool_call","server":"mssh","tool":"list_mcp_resources"}}`)), "unavailable tool")
	assert.ErrorContains(t, adapter.ValidateEvent([]byte(`{"type":"approval.requested","item":{"id":"i","type":"command_approval"}}`)), "approval")
	assert.ErrorContains(t, adapter.ValidateEvent([]byte(`not-json`)), "decode Codex event")
}

func TestApplyAIAgentCLIIsolationStatusHonorsCodexOptIn(t *testing.T) {
	status := model.AIAgentCLIStatus{Name: "Codex", Command: "codex", Installed: true, Version: "1.2.3"}
	blocked := applyAIAgentCLIIsolationStatus(status, false)
	assert.False(t, blocked.Installed)
	assert.Contains(t, blocked.Error, "cannot prove local shell isolation")
	assert.Empty(t, blocked.Version)
	allowed := applyAIAgentCLIIsolationStatus(status, true)
	assert.True(t, allowed.Installed)
	assert.Empty(t, allowed.Error)
	claude := model.AIAgentCLIStatus{Name: "Claude Code", Command: "claude", Installed: true}
	assert.True(t, applyAIAgentCLIIsolationStatus(claude, false).Installed)
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
	joined := strings.Join(command.Args, "\x00")
	assert.NotContains(t, joined, "--safe-mode")
	assert.NotContains(t, joined, "--tools")
	assert.Contains(t, joined, "--setting-sources\x00user")
	assert.Contains(t, joined, "--allowedTools")
	assert.Contains(t, joined, "mcp__mssh__*")
	assert.Contains(t, joined, "--disallowedTools")
	assert.Contains(t, joined, "--mcp-config")
	assert.Contains(t, joined, "--strict-mcp-config")
	assert.Contains(t, joined, "--permission-mode")
	assert.Contains(t, joined, "dontAsk")
	assert.Equal(t, "prompt", command.Args[len(command.Args)-1])
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
