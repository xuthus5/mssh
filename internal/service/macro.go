package service

import (
	"database/sql"
	"fmt"

	"mssh/internal/model"
	"mssh/internal/store"
)

type MacroService struct {
	db        *sql.DB
	terminals *TerminalService
}

func NewMacroService(db *sql.DB, terminals *TerminalService) *MacroService {
	return &MacroService{db: db, terminals: terminals}
}

func (m *MacroService) List() ([]model.Macro, error) {
	return store.ListMacros(m.db)
}

func (m *MacroService) Create(macro model.Macro) (*model.Macro, error) {
	return store.CreateMacro(m.db, macro)
}

func (m *MacroService) Update(macro model.Macro) error {
	return store.UpdateMacro(m.db, macro)
}

func (m *MacroService) Delete(id int64) error {
	return store.DeleteMacro(m.db, id)
}

func (m *MacroService) Execute(terminalID, command string) error {
	if m.terminals == nil {
		return fmt.Errorf("execute macro: no terminal service available")
	}
	_, err := m.terminals.Write(terminalID, []byte(command))
	if err != nil {
		return fmt.Errorf("execute macro: %w", err)
	}
	return nil
}
