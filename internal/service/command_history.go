package service

import (
	"database/sql"
	"log/slog"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type CommandHistoryService struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewCommandHistoryService(db *sql.DB, logger *slog.Logger) *CommandHistoryService {
	return &CommandHistoryService{db: db, logger: logger}
}

func (s *CommandHistoryService) Add(sessionID int64, command string) (*model.CommandHistory, error) {
	value := strings.TrimSpace(command)
	// Defense-in-depth: skip empty and sensitive commands (frontend already filters).
	if value == "" || isSensitiveCommand(value) {
		return nil, nil
	}
	return store.AddCommandHistory(s.db, sessionID, value)
}

func (s *CommandHistoryService) List(sessionID int64, query string) ([]model.CommandHistory, error) {
	return store.ListCommandHistory(s.db, sessionID, strings.TrimSpace(query), 10000)
}

func (s *CommandHistoryService) Delete(id int64) error { return store.DeleteCommandHistory(s.db, id) }

func (s *CommandHistoryService) Clear(sessionID int64) error {
	return store.ClearCommandHistory(s.db, sessionID)
}
