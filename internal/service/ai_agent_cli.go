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
	"strings"
	"sync"
	"syscall"
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
	adapter, err := newAIAgentCLIAdapter(task.CLI)
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

func runAIAgentCLIProcess(ctx context.Context, process aiAgentCLIProcess) error {
	command := commandWithContext(ctx, process.command)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open AI agent CLI stdout: %w", err)
	}
	stderr := newAIAgentBoundedBuffer(process.maxOutputBytes)
	command.Stderr = stderr
	if err = command.Start(); err != nil {
		return fmt.Errorf("start AI agent CLI: %w", err)
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

func commandWithContext(ctx context.Context, command *exec.Cmd) *exec.Cmd {
	contextCommand := exec.CommandContext(ctx, command.Path, command.Args[1:]...) // #nosec G204 -- adapter paths are fixed allowlisted executables.
	contextCommand.Dir, contextCommand.Env = command.Dir, command.Env
	contextCommand.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	contextCommand.Cancel = func() error { return killAIAgentProcessGroup(contextCommand) }
	contextCommand.WaitDelay = 2 * time.Second
	return contextCommand
}

func killAIAgentProcessGroup(command *exec.Cmd) error {
	if command.Process == nil {
		return os.ErrProcessDone
	}
	err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return os.ErrProcessDone
	}
	return err
}

func newAIAgentCLIAdapter(cli model.AIAgentCLI) (aiAgentCLIAdapter, error) {
	switch cli {
	case model.AIAgentCLIClaude:
		return claudeAIAgentAdapter{}, nil
	case model.AIAgentCLIOpenCode:
		return openCodeAIAgentAdapter{}, nil
	case model.AIAgentCLICodex:
		return nil, fmt.Errorf("codex CLI cannot prove local shell isolation in this installed version")
	default:
		return nil, fmt.Errorf("unsupported AI agent CLI %s", cli)
	}
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
