package service

import (
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
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
	m.logger.Info("creating macro", "name", macro.Name)
	return store.CreateMacro(m.db, macro)
}

func (m *MacroService) Update(input model.MacroInput) error {
	macro := input.Macro()
	m.logger.Info("updating macro", "id", macro.ID, "name", macro.Name)
	return store.UpdateMacro(m.db, macro)
}

func (m *MacroService) Delete(id int64) error {
	m.logger.Info("deleting macro", "id", id)
	return store.DeleteMacro(m.db, id)
}

func (m *MacroService) Execute(terminalID, command string) error {
	proposal := classifyAICommand(command, model.AISecuritySettings{})
	if proposal.Blocked {
		recordAudit(m.db, m.logger, model.AuditEvent{
			Action: "macro_execute", TargetType: "terminal", TargetID: terminalID,
			Summary: "宏执行被策略阻断", Outcome: "blocked",
		})
		return fmt.Errorf("macro blocked: %s", proposal.BlockedReason)
	}
	m.logger.Info("executing macro", "terminalID", terminalID)
	if m.terminals == nil {
		return fmt.Errorf("execute macro: no terminal service available")
	}
	_, err := m.terminals.Write(terminalID, command)
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
