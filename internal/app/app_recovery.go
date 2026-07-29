package app

import (
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/xuthus5/mssh/internal/store"
)

func recoverInterruptedRuntime(db *sql.DB, logger *slog.Logger, dependencies appDependencies) error {
	recoverTransfers := dependencies.recoverInterruptedTransfers
	if recoverTransfers == nil {
		recoverTransfers = store.MarkInterruptedTransfers
	}
	if err := recoverTransfers(db); err != nil {
		logger.Error("recover interrupted transfers failed", "error", err)
		return fmt.Errorf("recover interrupted transfers: %w", err)
	}
	if dependencies.recoverInterruptedAgents == nil {
		return nil
	}
	if err := dependencies.recoverInterruptedAgents(db); err != nil {
		logger.Error("recover interrupted AI agent tasks failed", "error", err)
		return fmt.Errorf("recover interrupted AI agent tasks: %w", err)
	}
	return nil
}
