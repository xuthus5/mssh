package service

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func appendAssetAudit(tx *sql.Tx, event model.AuditEvent) error {
	var raw string
	err := tx.QueryRow("SELECT value FROM settings WHERE key=?", store.AuditEnabledSetting).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	var enabled bool
	if err := json.Unmarshal([]byte(raw), &enabled); err != nil || !enabled {
		return err
	}
	createdAt := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = tx.Exec(`INSERT INTO audit_events (action, target_type, target_id, session_id, summary, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, event.Action, event.TargetType, event.TargetID, event.SessionID, event.Summary, event.Outcome, createdAt)
	return err
}
