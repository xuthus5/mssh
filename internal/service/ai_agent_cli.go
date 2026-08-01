package service

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const aiAgentMCPProtocolVersion = "2025-03-26"

type aiAgentCLIAdapter interface {
	Command(workDir, mcpURL, token, prompt string) (*exec.Cmd, error)
	ValidateEvent(line []byte) error
}

type aiAgentMCPBridge struct {
	service    *AIService
	taskCtx    context.Context
	task       model.AIAgentTask
	execution  *aiAgentExecution
	connection *aiAgentSSH
	security   model.AISecuritySettings
	token      string
	callGate   chan struct{}
	mu         sync.Mutex
	sequence   int
	result     string
	finished   bool
}

func (s *AIService) runLocalCLIAgent(ctx context.Context, task model.AIAgentTask, execution *aiAgentExecution, connection *aiAgentSSH, settings model.AISettings) (string, error) {
	adapter, err := newAIAgentCLIAdapter(task.CLI, settings.Interaction.Agent.AllowCodex)
	if err != nil {
		return "", err
	}
	workDir, err := os.MkdirTemp("", "mssh-agent-*")
	if err != nil {
		return "", fmt.Errorf("create AI agent private directory: %w", err)
	}
	if err = os.Chmod(workDir, 0o700); err != nil {
		_ = os.RemoveAll(workDir)
		return "", fmt.Errorf("secure AI agent private directory: %w", err)
	}
	defer func() {
		if removeErr := os.RemoveAll(workDir); removeErr != nil {
			s.logger.Warn("remove AI agent private directory failed", "taskID", task.ID, "error", removeErr)
		}
	}()
	token, err := randomAIAgentToken()
	if err != nil {
		return "", err
	}
	bridge := &aiAgentMCPBridge{service: s, taskCtx: ctx, task: task, execution: execution, connection: connection, security: settings.Security, token: token, sequence: task.StepCount}
	server, listener, err := startAIAgentMCPServer(bridge)
	if err != nil {
		return "", err
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		_ = listener.Close()
	}()
	mcpURL := "http://" + listener.Addr().String() + "/mcp"
	taskPrompt, err := buildAIAgentPrompt(task, aiAgentHistoryFromSteps(task.Steps))
	if err != nil {
		return "", err
	}
	prompt := fmt.Sprintf("%s\n\n%s\n必须使用 mssh MCP 工具，完成时调用 task.finish。", aiAgentSystemPrompt, taskPrompt)
	command, err := adapter.Command(workDir, mcpURL, token, prompt)
	if err != nil {
		return "", err
	}
	process := aiAgentCLIProcess{command: command, adapter: adapter, maxOutputBytes: settings.Security.MaxOutputBytes}
	if err = runAIAgentCLIProcess(ctx, process); err != nil {
		return "", err
	}
	bridge.mu.Lock()
	defer bridge.mu.Unlock()
	if !bridge.finished {
		return "", fmt.Errorf("AI agent CLI exited without calling task.finish")
	}
	return bridge.result, nil
}

type aiAgentCLIProcess struct {
	command        *exec.Cmd
	adapter        aiAgentCLIAdapter
	maxOutputBytes int
}

func runAIAgentCLIProcess(ctx context.Context, process aiAgentCLIProcess) (resultErr error) {
	command, lifecycle, err := commandWithContext(ctx, process.command)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := lifecycle.Close(); closeErr != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("close AI agent CLI process lifecycle: %w", closeErr))
		}
	}()
	stdout, err := command.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open AI agent CLI stdout: %w", err)
	}
	stderr := newAIAgentBoundedBuffer(process.maxOutputBytes)
	command.Stderr = stderr
	if err = command.Start(); err != nil {
		return fmt.Errorf("start AI agent CLI: %w", err)
	}
	if err = lifecycle.Started(command); err != nil {
		return stopAIAgentCLIProcessAfterStartFailure(command, err)
	}
	scanErr := scanAIAgentCLIEvents(stdout, process.adapter, process.maxOutputBytes)
	waitErr := command.Wait()
	if scanErr != nil {
		return scanErr
	}
	if waitErr != nil {
		return fmt.Errorf("AI agent CLI exited: %w: %s", waitErr, stderr.String())
	}
	return nil
}

func commandWithContext(ctx context.Context, command *exec.Cmd) (*exec.Cmd, aiAgentProcessLifecycle, error) {
	contextCommand := exec.CommandContext(ctx, command.Path, command.Args[1:]...) // #nosec G204 -- adapter paths are fixed allowlisted executables.
	contextCommand.Dir, contextCommand.Env = command.Dir, command.Env
	contextCommand.Stdin = command.Stdin
	lifecycle, err := newAIAgentProcessLifecycle(contextCommand)
	if err != nil {
		return nil, nil, fmt.Errorf("prepare AI agent CLI process lifecycle: %w", err)
	}
	contextCommand.Cancel = func() error { return lifecycle.Cancel(contextCommand) }
	contextCommand.WaitDelay = 2 * time.Second
	return contextCommand, lifecycle, nil
}

func stopAIAgentCLIProcessAfterStartFailure(command *exec.Cmd, startErr error) error {
	killErr := command.Process.Kill()
	if errors.Is(killErr, os.ErrProcessDone) {
		killErr = nil
	}
	waitErr := command.Wait()
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		waitErr = nil
	}
	return errors.Join(
		fmt.Errorf("bind AI agent CLI process lifecycle: %w", startErr),
		killErr,
		waitErr,
	)
}

func newAIAgentCLIAdapter(cli model.AIAgentCLI, allowCodex bool) (aiAgentCLIAdapter, error) {
	switch cli {
	case model.AIAgentCLIClaude:
		return claudeAIAgentAdapter{}, nil
	case model.AIAgentCLIOpenCode:
		return openCodeAIAgentAdapter{}, nil
	case model.AIAgentCLICodex:
		if !allowCodex {
			return nil, fmt.Errorf("codex CLI cannot prove local shell isolation in this installed version; enable the Codex weak isolation option in AI settings to run it anyway")
		}
		return codexAIAgentAdapter{}, nil
	default:
		return nil, fmt.Errorf("unsupported AI agent CLI %s", cli)
	}
}

const codexAIAgentTokenEnv = "MSSH_AGENT_TOKEN"

type codexAIAgentAdapter struct{}

func (codexAIAgentAdapter) Command(workDir, mcpURL, token, prompt string) (*exec.Cmd, error) {
	path, err := exec.LookPath("codex")
	if err != nil {
		return nil, fmt.Errorf("find Codex CLI: %w", err)
	}
	sandboxMode := "read-only"
	if runtime.GOOS == "windows" {
		// The Windows sandbox is experimental and read-only / workspace-write
		// modes have failed to spawn in released versions. Use the only mode
		// that runs reliably; local tool calls are still rejected by event
		// validation, which is the weak isolation contract of this option.
		sandboxMode = "danger-full-access"
	}
	args := []string{
		"exec",
		"--json",
		"--ephemeral",
		"--skip-git-repo-check",
		"--ignore-rules",
		"-C", workDir,
		"-c", fmt.Sprintf(`sandbox_mode=%q`, sandboxMode),
		"-c", `approval_policy="never"`,
		"-c", "features.plugins=false",
		"-c", "features.hooks=false",
		"-c", fmt.Sprintf(`mcp_servers.mssh.url=%q`, mcpURL),
		"-c", fmt.Sprintf(`mcp_servers.mssh.bearer_token_env_var=%q`, codexAIAgentTokenEnv),
		"-c", `mcp_servers.mssh.enabled_tools=['ssh.exec','ssh.list_dir','ssh.stat','ssh.read_file','ssh.write_file','task.finish']`,
		"-",
	}
	command := exec.Command(path, args...) // #nosec G204 -- path is resolved from fixed command name.
	command.Dir = workDir
	command.Env = append(os.Environ(), codexAIAgentTokenEnv+"="+token)
	command.Stdin = strings.NewReader(prompt)
	return command, nil
}

func (codexAIAgentAdapter) ValidateEvent(line []byte) error {
	return validateCodexAIAgentEvent(line)
}

type claudeAIAgentAdapter struct{}

func (claudeAIAgentAdapter) Command(workDir, mcpURL, token, prompt string) (*exec.Cmd, error) {
	path, err := exec.LookPath("claude")
	if err != nil {
		return nil, fmt.Errorf("find Claude Code CLI: %w", err)
	}
	configPath := filepath.Join(workDir, "claude-mcp.json")
	config, err := json.Marshal(map[string]any{"mcpServers": map[string]any{"mssh": map[string]any{"type": "http", "url": mcpURL, "headers": map[string]string{"Authorization": "Bearer " + token}}}})
	if err != nil {
		return nil, fmt.Errorf("encode Claude MCP config: %w", err)
	}
	if err = os.WriteFile(configPath, config, 0o600); err != nil {
		return nil, fmt.Errorf("write Claude MCP config: %w", err)
	}
	args := []string{"-p", "--output-format", "stream-json", "--verbose", "--safe-mode", "--no-chrome", "--setting-sources", "", "--tools", "", "--allowedTools", "mcp__mssh__*", "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit", "--mcp-config", configPath, "--strict-mcp-config", "--permission-mode", "dontAsk", "--no-session-persistence", "--disable-slash-commands", prompt}
	command := exec.Command(path, args...) // #nosec G204 -- path is resolved from fixed command name.
	command.Dir = workDir
	command.Env = append(os.Environ(), "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1")
	return command, nil
}

func (claudeAIAgentAdapter) ValidateEvent(line []byte) error {
	return validateAIAgentCLIEvent(line, "Claude Code")
}

type openCodeAIAgentAdapter struct{}

func (openCodeAIAgentAdapter) Command(workDir, mcpURL, token, prompt string) (*exec.Cmd, error) {
	path, err := exec.LookPath("opencode")
	if err != nil {
		return nil, fmt.Errorf("find OpenCode CLI: %w", err)
	}
	configPath := filepath.Join(workDir, "opencode.json")
	config := map[string]any{"$schema": "https://opencode.ai/config.json", "plugin": []string{}, "mcp": map[string]any{"mssh": map[string]any{"type": "remote", "url": mcpURL, "enabled": true, "oauth": false, "headers": map[string]string{"Authorization": "Bearer " + token}}}, "agent": map[string]any{"mssh": map[string]any{"mode": "primary", "tools": map[string]bool{"bash": false, "edit": false, "write": false, "read": false, "glob": false, "grep": false, "webfetch": false, "task": false}, "permission": map[string]string{"edit": "deny", "bash": "deny", "webfetch": "deny", "external_directory": "deny"}}}}
	data, err := json.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("encode OpenCode config: %w", err)
	}
	if err = os.WriteFile(configPath, data, 0o600); err != nil {
		return nil, fmt.Errorf("write OpenCode config: %w", err)
	}
	command := exec.Command(path, "run", "--pure", "--format", "json", "--agent", "mssh", "--dir", workDir, prompt) // #nosec G204 -- path is resolved from fixed command name.
	command.Dir = workDir
	command.Env = append(os.Environ(), "OPENCODE_CONFIG="+configPath)
	return command, nil
}

func (openCodeAIAgentAdapter) ValidateEvent(line []byte) error {
	return validateAIAgentCLIEvent(line, "OpenCode")
}

func scanAIAgentCLIEvents(reader io.Reader, adapter aiAgentCLIAdapter, maxBytes int) error {
	scanner := bufio.NewScanner(io.LimitReader(reader, int64(maxBytes)+1))
	scanner.Buffer(make([]byte, 4096), maxBytes)
	seen := false
	for scanner.Scan() {
		line := bytesTrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		seen = true
		if err := adapter.ValidateEvent(line); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read AI agent CLI events: %w", err)
	}
	if !seen {
		return fmt.Errorf("AI agent CLI emitted no JSON events")
	}
	return nil
}

func bytesTrimSpace(value []byte) []byte { return []byte(strings.TrimSpace(string(value))) }

func randomAIAgentToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate AI agent MCP token: %w", err)
	}
	return hex.EncodeToString(value), nil
}

func startAIAgentMCPServer(bridge *aiAgentMCPBridge) (*http.Server, net.Listener, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, nil, fmt.Errorf("listen for AI agent MCP: %w", err)
	}
	server := &http.Server{Handler: http.HandlerFunc(bridge.serveHTTP), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			bridge.service.logger.Error("AI agent MCP server failed", "taskID", bridge.task.ID, "error", serveErr)
		}
	}()
	return server, listener, nil
}
