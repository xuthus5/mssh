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

func (m *MacroService) Create(macro model.Macro) (*model.Macro, error) {
	m.logger.Info("creating macro", "name", macro.Name)
	return store.CreateMacro(m.db, macro)
}

func (m *MacroService) Update(macro model.Macro) error {
	m.logger.Info("updating macro", "id", macro.ID, "name", macro.Name)
	return store.UpdateMacro(m.db, macro)
}

func (m *MacroService) Delete(id int64) error {
	m.logger.Info("deleting macro", "id", id)
	return store.DeleteMacro(m.db, id)
}

func (m *MacroService) Execute(terminalID, command string) error {
	m.logger.Info("executing macro", "terminalID", terminalID, "command", command)
	if m.terminals == nil {
		return fmt.Errorf("execute macro: no terminal service available")
	}
	_, err := m.terminals.Write(terminalID, command)
	if err != nil {
		return fmt.Errorf("execute macro: %w", err)
	}
	return nil
}
