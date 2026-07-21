package service

import (
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type AuditService struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewAuditService(db *sql.DB, logger *slog.Logger) *AuditService {
	return &AuditService{db: db, logger: logger}
}

func (a *AuditService) Enabled() (bool, error) {
	return store.AuditEnabled(a.db)
}

func (a *AuditService) SetEnabled(enabled bool) error {
	return store.SetAuditEnabled(a.db, enabled)
}

func (a *AuditService) List(filter model.AuditFilter) ([]model.AuditEvent, error) {
	return store.ListAuditEvents(a.db, filter)
}

func (a *AuditService) RecordBatch(action string, sessionIDs []int64, outcomes []string) error {
	if action != "batch_connect" && action != "batch_macro" {
		return fmt.Errorf("unsupported batch audit action %s", action)
	}
	if len(sessionIDs) != len(outcomes) {
		return fmt.Errorf("batch audit results length mismatch")
	}
	for index, sessionID := range sessionIDs {
		if outcomes[index] != "success" && outcomes[index] != "failed" {
			return fmt.Errorf("invalid batch audit outcome %s", outcomes[index])
		}
		event := model.AuditEvent{Action: action, TargetType: "session", TargetID: fmt.Sprint(sessionID), SessionID: &sessionID, Summary: "批量会话操作", Outcome: outcomes[index]}
		if err := store.AppendAuditEvent(a.db, event); err != nil {
			a.logger.Error("record batch audit failed", "action", action, "sessionID", sessionID, "error", err)
			return err
		}
	}
	return nil
}

func recordAudit(db *sql.DB, logger *slog.Logger, event model.AuditEvent) {
	event.Summary = sanitizeLogValue(event.Summary)
	event.TargetID = sanitizeLogValue(event.TargetID)
	if err := store.AppendAuditEvent(db, event); err != nil {
		logger.Error("record audit event failed", "action", event.Action, "error", err)
	}
}
