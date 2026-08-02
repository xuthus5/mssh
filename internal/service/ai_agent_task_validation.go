package service

import (
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func (s *AIService) validateAIAgentTaskInput(input *model.AIAgentTaskInput) error {
	input.Prompt = strings.TrimSpace(input.Prompt)
	if input.SessionID <= 0 || input.Prompt == "" {
		return fmt.Errorf("session and task prompt are required")
	}
	if len(input.Prompt) > maxAIAgentPromptBytes {
		return fmt.Errorf("AI agent task prompt is too large")
	}
	if s.sessions == nil {
		return fmt.Errorf("AI agent SSH runtime is unavailable")
	}
	if _, err := store.GetSession(s.db, input.SessionID); err != nil {
		return err
	}
	return nil
}

func resolveAIAgentSelection(input model.AIAgentTaskInput, defaults model.AIAgentSettings) (model.AIAgentEngine, model.AIAgentCLI, error) {
	engine := defaults.DefaultEngine
	cli := defaults.DefaultCLI
	if input.Engine != nil {
		engine = *input.Engine
	}
	if input.CLI != nil {
		cli = *input.CLI
	}
	if err := validateAIAgentSettings(model.AIAgentSettings{DefaultEngine: engine, DefaultCLI: cli}); err != nil {
		return "", "", err
	}
	if engine == model.AIAgentEngineNative {
		cli = ""
	}
	return engine, cli, nil
}

func validateInstalledAIAgentCLI(cli model.AIAgentCLI, allowCodex bool) error {
	if _, err := newAIAgentCLIAdapter(cli, allowCodex); err != nil {
		return err
	}
	status := detectAICLI(string(cli), string(cli))
	if !status.Installed || status.Error != "" {
		return fmt.Errorf("AI agent CLI %s is unavailable: %s", cli, status.Error)
	}
	return nil
}

func validateAIAgentDefaultAvailability(settings model.AIAgentSettings) error {
	if settings.DefaultEngine == model.AIAgentEngineNative {
		return nil
	}
	return validateInstalledAIAgentCLI(settings.DefaultCLI, settings.AllowCodex)
}

func normalizeAIAgentTaskCreateError(err error) error {
	if strings.Contains(strings.ToLower(err.Error()), "unique constraint failed") {
		return fmt.Errorf("this SSH session already has an active AI agent task")
	}
	return err
}
