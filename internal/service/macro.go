package service

import (
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const maxMacroCommandBytes = 32 * 1024

const (
	maxMacroNameRunes     = 128
	maxMacroShortcutRunes = 64
	maxMacroSortOrder     = 1_000_000
)

type MacroService struct {
	db        *sql.DB
	terminals *TerminalService
	logger    *slog.Logger
}

func NewMacroService(db *sql.DB, terminals *TerminalService, logger *slog.Logger) *MacroService {
	return &MacroService{db: db, terminals: terminals, logger: logger}
}

func (m *MacroService) List() ([]model.Macro, error) {
	return store.ListMacros(m.db)
}

func (m *MacroService) Create(input model.MacroInput) (*model.Macro, error) {
	macro := input.Macro()
	if err := validateMacroPayload(macro); err != nil {
		return nil, err
	}
	m.logger.Info("creating macro", "name", macro.Name)
	return store.CreateMacro(m.db, macro)
}

func (m *MacroService) Update(input model.MacroInput) error {
	macro := input.Macro()
	if macro.ID <= 0 {
		return fmt.Errorf("invalid macro id")
	}
	if err := validateMacroPayload(macro); err != nil {
		return err
	}
	m.logger.Info("updating macro", "id", macro.ID, "name", macro.Name)
	return store.UpdateMacro(m.db, macro)
}

func validateMacroPayload(macro model.Macro) error {
	name := strings.TrimSpace(macro.Name)
	if name == "" {
		return fmt.Errorf("macro name is required")
	}
	if strings.ContainsRune(name, 0) {
		return fmt.Errorf("macro name contains NUL")
	}
	if utf8.RuneCountInString(name) > maxMacroNameRunes {
		return fmt.Errorf("macro name must not exceed %d characters", maxMacroNameRunes)
	}
	command := strings.TrimSpace(macro.Command)
	if command == "" {
		return fmt.Errorf("macro command is required")
	}
	if strings.ContainsRune(macro.Command, 0) {
		return fmt.Errorf("macro command contains NUL")
	}
	if len(macro.Command) > maxMacroCommandBytes {
		return fmt.Errorf("macro command exceeds size limit")
	}
	shortcut := strings.TrimSpace(macro.Shortcut)
	if strings.ContainsRune(shortcut, 0) {
		return fmt.Errorf("macro shortcut contains NUL")
	}
	if utf8.RuneCountInString(shortcut) > maxMacroShortcutRunes {
		return fmt.Errorf("macro shortcut must not exceed %d characters", maxMacroShortcutRunes)
	}
	if macro.DelayMs < 0 || macro.DelayMs > 60_000 {
		return fmt.Errorf("macro delay must be between 0 and 60000 ms")
	}
	if macro.SortOrder < 0 || macro.SortOrder > maxMacroSortOrder {
		return fmt.Errorf("macro sort order must be between 0 and %d", maxMacroSortOrder)
	}
	return nil
}

func (m *MacroService) Delete(id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid macro id")
	}
	m.logger.Info("deleting macro", "id", id)
	return store.DeleteMacro(m.db, id)
}

func (m *MacroService) Execute(terminalID, command string) error {
	security := m.loadMacroSecuritySettings()
	proposal := classifyAICommand(command, security)
	if proposal.Blocked {
		recordAudit(m.db, m.logger, model.AuditEvent{
			Action: "macro_execute", TargetType: "terminal", TargetID: terminalID,
			Summary: "宏执行被策略阻断", Outcome: "blocked",
		})
		return fmt.Errorf("macro blocked: %s", proposal.BlockedReason)
	}
	if len(command) > maxMacroCommandBytes {
		recordAudit(m.db, m.logger, model.AuditEvent{
			Action: "macro_execute", TargetType: "terminal", TargetID: terminalID,
			Summary: "宏执行命令过长", Outcome: "blocked",
		})
		return fmt.Errorf("macro command exceeds size limit")
	}
	m.logger.Info("executing macro", "terminalID", terminalID)
	if m.terminals == nil {
		return fmt.Errorf("execute macro: no terminal service available")
	}
	timeout := time.Duration(security.CommandTimeoutSeconds) * time.Second
	if timeout < time.Second {
		timeout = time.Duration(defaultAISettings().Security.CommandTimeoutSeconds) * time.Second
	}
	err := writeTerminalWithTimeout(m.terminals, terminalID, command, timeout)
	outcome := "success"
	if err != nil {
		outcome = "failed"
	}
	recordAudit(m.db, m.logger, model.AuditEvent{
		Action: "macro_execute", TargetType: "terminal", TargetID: terminalID,
		Summary: "宏执行", Outcome: outcome,
	})
	if err != nil {
		return fmt.Errorf("execute macro: %w", err)
	}
	return nil
}

func (m *MacroService) loadMacroSecuritySettings() model.AISecuritySettings {
	settings, err := store.LoadAISettings(m.db, defaultAISettings())
	if err != nil {
		return defaultAISettings().Security
	}
	return settings.Security
}
