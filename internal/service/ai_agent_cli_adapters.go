package service

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

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

type codexAIAgentAdapter struct {
	codexHome string
}

func (adapter codexAIAgentAdapter) Command(workDir, mcpURL, token, prompt string) (*exec.Cmd, error) {
	path, err := exec.LookPath("codex")
	if err != nil {
		return nil, fmt.Errorf("find Codex CLI: %w", err)
	}
	codexHome := adapter.codexHome
	if codexHome == "" {
		if envHome := os.Getenv("CODEX_HOME"); envHome != "" {
			codexHome = envHome
		} else if home, homeErr := os.UserHomeDir(); homeErr == nil {
			codexHome = filepath.Join(home, ".codex")
		}
	}
	catalogPath, err := prepareCodexModelCatalogForMCP(workDir, codexHome)
	if err != nil {
		return nil, err
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
	}
	if catalogPath != "" {
		args = append(args, "-c", fmt.Sprintf(`model_catalog_json=%q`, filepath.ToSlash(catalogPath)))
	}
	args = append(args, "-")
	command := exec.Command(path, args...) // #nosec G204 -- path is resolved from fixed command name.
	command.Dir = workDir
	command.Env = append(os.Environ(), codexAIAgentTokenEnv+"="+token)
	command.Stdin = strings.NewReader(prompt)
	return command, nil
}

// codexModelCatalogFileName is the conventional Codex model catalog location.
const codexModelCatalogFileName = "models.json"

// prepareCodexModelCatalogForMCP writes a copy of the user's Codex model
// catalog with supports_search_tool disabled into the private agent work
// directory and returns its path, or an empty string when no override is
// needed. Models that advertise supports_search_tool=true make Codex defer
// every MCP tool behind tool search; when tool search is unavailable the mssh
// MCP tools stay invisible and the agent falls back to local tools, which the
// bridge rejects. Disabling the flag exposes MCP tools directly (see
// openai/codex#36382).
func prepareCodexModelCatalogForMCP(workDir, codexHome string) (string, error) {
	source := filepath.Join(codexHome, codexModelCatalogFileName)
	if configured := codexModelCatalogPathFromConfig(codexHome); configured != "" {
		source = configured
	}
	data, err := os.ReadFile(source)
	if err != nil {
		// A missing or unreadable catalog keeps the default exposure.
		return "", nil
	}
	var catalog map[string]any
	if err = json.Unmarshal(data, &catalog); err != nil {
		return "", nil
	}
	models, ok := catalog["models"].([]any)
	if !ok {
		return "", nil
	}
	changed := false
	for _, entry := range models {
		model, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if enabled, ok := model["supports_search_tool"].(bool); ok && enabled {
			model["supports_search_tool"] = false
			changed = true
		}
	}
	if !changed {
		return "", nil
	}
	overridden, err := json.Marshal(catalog)
	if err != nil {
		return "", nil
	}
	catalogPath := filepath.Join(workDir, "codex-models.json")
	if err = os.WriteFile(catalogPath, overridden, 0o600); err != nil {
		return "", fmt.Errorf("write Codex model catalog override: %w", err)
	}
	return catalogPath, nil
}

// codexModelCatalogPathFromConfig extracts the model_catalog_json path from
// the Codex config.toml with a minimal line scan. The key is a top-level
// string assignment in the conventional configuration, so a full TOML parser
// is not worth a dependency here.
func codexModelCatalogPathFromConfig(codexHome string) string {
	data, err := os.ReadFile(filepath.Join(codexHome, "config.toml"))
	if err != nil {
		return ""
	}
	for _, rawLine := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(rawLine)
		if !strings.HasPrefix(line, "model_catalog_json") {
			continue
		}
		rest := strings.TrimSpace(strings.TrimPrefix(line, "model_catalog_json"))
		rest = strings.TrimSpace(strings.TrimPrefix(rest, "="))
		value := strings.TrimSpace(rest)
		if len(value) < 2 {
			return ""
		}
		quote := value[0]
		if quote != '"' && quote != '\'' {
			return ""
		}
		if end := strings.IndexByte(value[1:], quote); end >= 0 {
			return value[1 : 1+end]
		}
		return ""
	}
	return ""
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
	// Claude's argument parser drops empty-string values: --setting-sources ""
	// then consumes the next flag and exits with status 1, and --tools ""
	// disables every tool including MCP servers. --safe-mode also skips the
	// --mcp-config servers entirely. Load only the user settings explicitly
	// (the private agent work directory carries no project or local settings)
	// and restrict tools through allow/deny lists plus dontAsk mode.
	args := []string{"-p", "--output-format", "stream-json", "--verbose", "--no-chrome", "--setting-sources", "user", "--allowedTools", "mcp__mssh__*", "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit", "--mcp-config", configPath, "--strict-mcp-config", "--permission-mode", "dontAsk", "--no-session-persistence", "--disable-slash-commands", prompt}
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
	// The prompt is passed through stdin instead of as a positional argument:
	// OpenCode's CLI parser truncates message arguments at embedded double
	// quotes, and the agent prompt contains a JSON template with quotes.
	command := exec.Command(path, "run", "--pure", "--format", "json", "--agent", "mssh", "--dir", workDir) // #nosec G204 -- path is resolved from fixed command name.
	command.Dir = workDir
	command.Env = append(os.Environ(), "OPENCODE_CONFIG="+configPath)
	command.Stdin = strings.NewReader(prompt)
	return command, nil
}

func (openCodeAIAgentAdapter) ValidateEvent(line []byte) error {
	return validateAIAgentCLIEvent(line, "OpenCode")
}
