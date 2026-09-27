package service

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

const aiAgentCustomCLIPrefix = "custom:"

// aiAgentCustomCLIValue encodes a custom CLI entry as a task-selectable CLI
// value. Each entry carries a stable ID so multiple custom CLIs can coexist.
func aiAgentCustomCLIValue(id string) model.AIAgentCLI {
	return model.AIAgentCLI(aiAgentCustomCLIPrefix + id)
}

func aiAgentCustomCLIID(cli model.AIAgentCLI) (string, bool) {
	value := string(cli)
	if strings.HasPrefix(value, aiAgentCustomCLIPrefix) {
		return strings.TrimPrefix(value, aiAgentCustomCLIPrefix), true
	}
	return "", false
}

func resolveCustomAICLI(list []model.AICustomCLI, cli model.AIAgentCLI) *model.AICustomCLI {
	id, ok := aiAgentCustomCLIID(cli)
	if !ok {
		return nil
	}
	for index := range list {
		if list[index].ID == id {
			return &list[index]
		}
	}
	return nil
}

func validateAIAgentCLI(settings model.AIAgentSettings) error {
	if err := validateCustomAICLIList(settings.CustomCLIs); err != nil {
		return err
	}
	switch settings.DefaultCLI {
	case model.AIAgentCLICodex, model.AIAgentCLIClaude, model.AIAgentCLIOpenCode:
		return nil
	}
	custom := resolveCustomAICLI(settings.CustomCLIs, settings.DefaultCLI)
	if custom == nil {
		return fmt.Errorf("unsupported default AI agent CLI %s", settings.DefaultCLI)
	}
	if strings.TrimSpace(custom.Command) == "" {
		return fmt.Errorf("custom AI agent CLI is not configured")
	}
	return nil
}

func validateCustomAICLIList(list []model.AICustomCLI) error {
	seen := make(map[string]struct{}, len(list))
	for _, custom := range list {
		id := strings.TrimSpace(custom.ID)
		if id == "" {
			return fmt.Errorf("custom AI agent CLI id is required")
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("duplicate custom AI agent CLI id %s", id)
		}
		seen[id] = struct{}{}
	}
	return nil
}

// customAIAgentAdapter launches a user-registered CLI as a launcher for its own
// pre-configured MCP server. Only the work directory and prompt are templated;
// MSSH never passes MCP credentials.
type customAIAgentAdapter struct {
	config model.AICustomCLI
}

func (adapter customAIAgentAdapter) Command(workDir, mcpURL, token, prompt string) (*exec.Cmd, error) {
	config := adapter.config
	executable := strings.TrimSpace(config.Command)
	if executable == "" {
		return nil, fmt.Errorf("custom AI agent CLI command is required")
	}
	path, err := exec.LookPath(executable)
	if err != nil {
		return nil, fmt.Errorf("find custom AI agent CLI %q: %w", executable, err)
	}
	template := aiAgentCustomTemplate{workDir: workDir, prompt: prompt}
	args := template.expandAll(config.Args)
	if config.PromptMode == model.AIAgentPromptArg && !aiAgentCustomUsesPromptPlaceholder(config.Args) {
		args = append(args, prompt)
	}
	// #nosec G204 -- the executable is user-registered and resolved via exec.LookPath.
	command := exec.Command(path, args...)
	command.Dir = workDir
	command.Env = append(os.Environ(), template.expandAll(config.Env)...)
	if config.PromptMode == model.AIAgentPromptArg {
		return command, nil
	}
	command.Stdin = strings.NewReader(prompt)
	return command, nil
}

// ValidateEvent accepts any line: a custom CLI's stdout is opaque output (its
// final answer), not an event stream. runAIAgentCLIProcess collects it verbatim
// instead of scanning it.
func (customAIAgentAdapter) ValidateEvent([]byte) error { return nil }

// ManagesOwnMCP marks a CLI that talks to an MCP server it configured itself, so
// MSSH only launches it and never injects a per-task endpoint. Built-in adapters
// do not implement this, so their behavior is unchanged.
func (customAIAgentAdapter) ManagesOwnMCP() bool { return true }

// aiAgentOwnMCPAdapter is the optional capability described above.
type aiAgentOwnMCPAdapter interface {
	ManagesOwnMCP() bool
}

func aiAgentCustomUsesPromptPlaceholder(args []string) bool {
	return aiAgentCustomUsesPlaceholder(args, "{prompt}")
}

func aiAgentCustomUsesPlaceholder(values []string, placeholder string) bool {
	for _, value := range values {
		if strings.Contains(value, placeholder) {
			return true
		}
	}
	return false
}

type aiAgentCustomTemplate struct {
	workDir string
	prompt  string
}

func (template aiAgentCustomTemplate) expand(value string) string {
	replacer := strings.NewReplacer(
		"{workdir}", template.workDir,
		"{prompt}", template.prompt,
	)
	return replacer.Replace(value)
}

func (template aiAgentCustomTemplate) expandAll(values []string) []string {
	expanded := make([]string, 0, len(values))
	for _, value := range values {
		expanded = append(expanded, template.expand(value))
	}
	return expanded
}
