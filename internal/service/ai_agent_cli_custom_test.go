package service

import (
	"context"
	"io"
	"os"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestDetectAgentCLIsIncludesConfiguredCustomCLIs(t *testing.T) {
	db := testutil.NewTestDB(t)
	directory := t.TempDir()
	installAIAgentTestLauncher(t, directory, "custom-cli", "TestAIAgentVersionHelperProcess")
	t.Setenv("MSSH_AGENT_VERSION_HELPER", "success")
	setAIAgentTestPath(t, directory)
	service := NewAIService(db, nil, nil, testutil.NewTestLogger())
	settings := defaultAISettings()
	settings.Interaction.Agent.CustomCLIs = []model.AICustomCLI{
		{ID: "one", Name: "Mine", Command: "custom-cli"},
		{ID: "two", Name: "Unset"},
	}
	require.NoError(t, store.SaveAISettings(db, settings))

	statuses := service.DetectAgentCLIs()

	require.Len(t, statuses, 4)
	assert.Equal(t, string(aiAgentCustomCLIValue("one")), statuses[3].Command)
	assert.Equal(t, "Mine", statuses[3].Name)
	assert.True(t, statuses[3].Installed)
}

func TestCustomAIAgentAdapterCommandWithPromptArg(t *testing.T) {
	binDir := t.TempDir()
	installAIAgentTestLauncher(t, binDir, "custom-cli", "TestAIAgentCLIProcessHelper")
	setAIAgentTestPath(t, binDir)
	adapter := customAIAgentAdapter{config: model.AICustomCLI{
		ID:         "one",
		Name:       "Custom",
		Command:    "custom-cli",
		Args:       []string{"--dir", "{workdir}"},
		Env:        []string{"MSSH_WORKDIR={workdir}"},
		PromptMode: model.AIAgentPromptArg,
	}}

	command, err := adapter.Command("/tmp/work", "", "", "do it")

	require.NoError(t, err)
	assert.Equal(t, []string{"--dir", "/tmp/work", "do it"}, command.Args[1:])
	assert.Contains(t, command.Env, "MSSH_WORKDIR=/tmp/work")
	assert.Equal(t, "/tmp/work", command.Dir)
	assert.Nil(t, command.Stdin)
}

func TestCustomAIAgentAdapterCommandWithPromptStdin(t *testing.T) {
	binDir := t.TempDir()
	installAIAgentTestLauncher(t, binDir, "custom-cli", "TestAIAgentCLIProcessHelper")
	setAIAgentTestPath(t, binDir)
	promptArgAdapter := customAIAgentAdapter{config: model.AICustomCLI{Command: "custom-cli", Args: []string{"{workdir}", "{prompt}"}}}

	command, err := promptArgAdapter.Command("/w", "", "", "hello")

	require.NoError(t, err)
	assert.Equal(t, []string{"/w", "hello"}, command.Args[1:])

	stdinAdapter := customAIAgentAdapter{config: model.AICustomCLI{Command: "custom-cli", Args: []string{"{workdir}"}}}
	command, err = stdinAdapter.Command("/w", "", "", "hello")
	require.NoError(t, err)
	require.NotNil(t, command.Stdin)
	stdin, err := io.ReadAll(command.Stdin)
	require.NoError(t, err)
	assert.Equal(t, "hello", string(stdin))
}

func TestCustomAIAgentAdapterFailsClosed(t *testing.T) {
	_, err := customAIAgentAdapter{config: model.AICustomCLI{}}.Command("w", "u", "t", "p")
	assert.ErrorContains(t, err, "command is required")

	t.Setenv("PATH", t.TempDir())
	_, err = customAIAgentAdapter{config: model.AICustomCLI{Command: "missing-cli"}}.Command("w", "u", "t", "p")
	assert.ErrorContains(t, err, "find custom AI agent CLI")
}

func TestCustomAIAgentAdapterValidateEvent(t *testing.T) {
	adapter := customAIAgentAdapter{}
	assert.NoError(t, adapter.ValidateEvent([]byte("plain text answer")))
	assert.NoError(t, adapter.ValidateEvent([]byte(`{"type":"message"}`)))
}

func TestCustomAIAgentAdapterManagesOwnMCP(t *testing.T) {
	own, ok := aiAgentCLIAdapter(customAIAgentAdapter{}).(aiAgentOwnMCPAdapter)
	require.True(t, ok)
	assert.True(t, own.ManagesOwnMCP())

	_, builtInOk := aiAgentCLIAdapter(claudeAIAgentAdapter{}).(aiAgentOwnMCPAdapter)
	assert.False(t, builtInOk)
}

func TestBuildOwnMCPAgentPromptOmitsNativeToolProtocol(t *testing.T) {
	task := model.AIAgentTask{ID: 1, SessionID: 1, SessionName: "session", Prompt: "inspect host"}

	prompt, err := buildOwnMCPAgentPrompt(task)

	require.NoError(t, err)
	assert.Contains(t, prompt, "inspect host")
	assert.Contains(t, prompt, "mssh MCP")
	assert.NotContains(t, prompt, `"tool"`)
	assert.NotContains(t, prompt, "task.finish")
}

func TestRunAIAgentCLIWithOwnMCPRequiresRunningEndpoint(t *testing.T) {
	binDir := t.TempDir()
	installAIAgentTestLauncher(t, binDir, "custom-cli", "TestAIAgentCLIProcessHelper")
	setAIAgentTestPath(t, binDir)
	service, session := newMCPServerTestService(t)
	adapter := customAIAgentAdapter{config: model.AICustomCLI{Command: "custom-cli"}}
	task := model.AIAgentTask{ID: 1, SessionID: session.ID, SessionName: "session", Prompt: "inspect"}

	_, err := service.runAIAgentCLIWithOwnMCP(context.Background(), adapter, t.TempDir(), task, defaultAISettings())

	assert.ErrorContains(t, err, "MCP 服务未启动")
}

func TestRunAIAgentCLIWithOwnMCPReturnsStdout(t *testing.T) {
	binDir := t.TempDir()
	installAIAgentTestLauncher(t, binDir, "custom-cli", "TestAIAgentCLIProcessHelper")
	setAIAgentTestPath(t, binDir)
	t.Setenv("MSSH_AGENT_CLI_PROCESS_MODE", "success")
	service, session := newMCPServerTestService(t)
	_, err := service.StartAgentMCPServer(model.AIMCPServerInput{SessionID: session.ID})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, service.StopAgentMCPServer()) })
	adapter := customAIAgentAdapter{config: model.AICustomCLI{Command: "custom-cli"}}
	task := model.AIAgentTask{ID: 1, SessionID: session.ID, SessionName: "session", Prompt: "inspect host"}

	output, err := service.runAIAgentCLIWithOwnMCP(context.Background(), adapter, t.TempDir(), task, defaultAISettings())

	require.NoError(t, err)
	assert.Contains(t, output, "assistant")
}

func TestRunAIAgentCLIWithOwnMCPAcceptsPlainTextOutput(t *testing.T) {
	binDir := t.TempDir()
	installAIAgentTestLauncher(t, binDir, "custom-cli", "TestAIAgentCLIProcessHelper")
	setAIAgentTestPath(t, binDir)
	t.Setenv("MSSH_AGENT_CLI_PROCESS_MODE", "invalid")
	service, session := newMCPServerTestService(t)
	_, err := service.StartAgentMCPServer(model.AIMCPServerInput{SessionID: session.ID})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, service.StopAgentMCPServer()) })
	adapter := customAIAgentAdapter{config: model.AICustomCLI{Command: "custom-cli"}}
	task := model.AIAgentTask{ID: 1, SessionID: session.ID, SessionName: "session", Prompt: "inspect"}

	output, err := service.runAIAgentCLIWithOwnMCP(context.Background(), adapter, t.TempDir(), task, defaultAISettings())

	require.NoError(t, err)
	assert.Contains(t, output, "bad")
}

func TestRunAIAgentCLIProcessReturnsStdout(t *testing.T) {
	testBinary, err := os.Executable()
	require.NoError(t, err)
	command := exec.Command(testBinary, "-test.run=^TestAIAgentCLIProcessHelper$")
	command.Env = append(os.Environ(), "MSSH_AGENT_CLI_PROCESS_MODE=success")
	process := aiAgentCLIProcess{command: command, adapter: customAIAgentAdapter{}, maxOutputBytes: 256}

	output, err := runAIAgentCLIProcess(context.Background(), process)

	require.NoError(t, err)
	assert.Contains(t, output, "assistant")
}

func TestDetectCustomAICLI(t *testing.T) {
	directory := t.TempDir()
	installAIAgentTestLauncher(t, directory, "custom-cli", "TestAIAgentVersionHelperProcess")
	t.Setenv("MSSH_AGENT_VERSION_HELPER", "success")
	setAIAgentTestPath(t, directory)

	status := detectCustomAICLI(context.Background(), model.AICustomCLI{ID: "one", Name: "My CLI", Command: "custom-cli"})
	assert.True(t, status.Installed)
	assert.Equal(t, "My CLI", status.Name)
	assert.Equal(t, string(aiAgentCustomCLIValue("one")), status.Command)
	assert.Equal(t, "agent-test 1.2.3", status.Version)

	missing := detectCustomAICLI(context.Background(), model.AICustomCLI{ID: "two", Command: "missing-cli"})
	assert.False(t, missing.Installed)
	assert.Equal(t, "Custom CLI", missing.Name)
}

func TestValidateAIAgentSettingsCustomCLIs(t *testing.T) {
	settings := model.AIAgentSettings{DefaultEngine: model.AIAgentEngineLocalCLI, DefaultCLI: aiAgentCustomCLIValue("one")}
	assert.ErrorContains(t, validateAIAgentSettings(settings), "unsupported default AI agent CLI")

	settings.CustomCLIs = []model.AICustomCLI{{ID: "one"}}
	assert.ErrorContains(t, validateAIAgentSettings(settings), "not configured")

	settings.CustomCLIs = []model.AICustomCLI{{ID: "one", Command: "custom-cli"}}
	assert.NoError(t, validateAIAgentSettings(settings))

	settings.CustomCLIs = []model.AICustomCLI{{ID: "one", Command: "a"}, {ID: "one", Command: "b"}}
	assert.ErrorContains(t, validateAIAgentSettings(settings), "duplicate")

	settings.CustomCLIs = []model.AICustomCLI{{Command: "a"}}
	assert.ErrorContains(t, validateAIAgentSettings(settings), "id is required")

	settings.CustomCLIs = nil
	settings.DefaultCLI = model.AIAgentCLICodex
	assert.NoError(t, validateAIAgentSettings(settings))
}

func TestNewAIAgentCLIAdapterCustom(t *testing.T) {
	_, err := newAIAgentCLIAdapter(aiAgentCustomCLIValue("missing"), false, nil)
	assert.ErrorContains(t, err, "unsupported AI agent CLI")

	adapter, err := newAIAgentCLIAdapter(aiAgentCustomCLIValue("one"), false, []model.AICustomCLI{{ID: "one", Command: "custom-cli"}})
	require.NoError(t, err)
	assert.IsType(t, customAIAgentAdapter{}, adapter)

	_, err = newAIAgentCLIAdapter(aiAgentCustomCLIValue("one"), false, []model.AICustomCLI{{ID: "one"}})
	assert.ErrorContains(t, err, "not configured")
}

func TestResolveAIAgentSelectionSupportsCustomCLI(t *testing.T) {
	defaults := model.AIAgentSettings{
		DefaultEngine: model.AIAgentEngineLocalCLI,
		DefaultCLI:    aiAgentCustomCLIValue("one"),
		CustomCLIs:    []model.AICustomCLI{{ID: "one", Command: "cmdc"}},
	}

	engine, cli, err := resolveAIAgentSelection(model.AIAgentTaskInput{SessionID: 1, Prompt: "list files"}, defaults)
	require.NoError(t, err)
	assert.Equal(t, model.AIAgentEngineLocalCLI, engine)
	assert.Equal(t, aiAgentCustomCLIValue("one"), cli)

	engineValue := model.AIAgentEngineLocalCLI
	explicit := aiAgentCustomCLIValue("one")
	_, cli, err = resolveAIAgentSelection(model.AIAgentTaskInput{SessionID: 1, Prompt: "list files", Engine: &engineValue, CLI: &explicit}, defaults)
	require.NoError(t, err)
	assert.Equal(t, explicit, cli)

	_, _, err = resolveAIAgentSelection(model.AIAgentTaskInput{SessionID: 1, Prompt: "list files"}, model.AIAgentSettings{DefaultEngine: model.AIAgentEngineLocalCLI, DefaultCLI: aiAgentCustomCLIValue("one")})
	assert.ErrorContains(t, err, "unsupported default AI agent CLI")
}

func TestValidateInstalledAIAgentCLICustom(t *testing.T) {
	directory := t.TempDir()
	installAIAgentTestLauncher(t, directory, "custom-cli", "TestAIAgentVersionHelperProcess")
	t.Setenv("MSSH_AGENT_VERSION_HELPER", "success")
	setAIAgentTestPath(t, directory)
	customCLIs := []model.AICustomCLI{{ID: "one", Command: "custom-cli"}}
	assert.NoError(t, validateInstalledAIAgentCLI(aiAgentCustomCLIValue("one"), false, customCLIs))

	t.Setenv("PATH", t.TempDir())
	assert.ErrorContains(t, validateInstalledAIAgentCLI(aiAgentCustomCLIValue("one"), false, customCLIs), "unavailable")
}
