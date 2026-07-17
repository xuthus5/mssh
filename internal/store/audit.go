package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

const AuditEnabledSetting = "audit.enabled"

func AuditEnabled(db *sql.DB) (bool, error) {
	var raw string
	err := db.QueryRow("SELECT value FROM settings WHERE key = ?", AuditEnabledSetting).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read audit setting: %w", err)
	}
	var enabled bool
	if err := json.Unmarshal([]byte(raw), &enabled); err != nil {
		return false, fmt.Errorf("decode audit setting: %w", err)
	}
	return enabled, nil
}

func SetAuditEnabled(db *sql.DB, enabled bool) error {
	value := "false"
	if enabled {
		value = "true"
	}
	_, err := db.Exec(`INSERT INTO settings (key, namespace, value, value_type, version) VALUES (?, 'audit', ?, 'boolean', 1) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`, AuditEnabledSetting, value)
	return err
}

func AppendAuditEvent(db *sql.DB, event model.AuditEvent) error {
	enabled, err := AuditEnabled(db)
	if err != nil || !enabled {
		return err
	}
	createdAt := event.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	_, err = db.Exec(`INSERT INTO audit_events (action, target_type, target_id, session_id, summary, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, event.Action, event.TargetType, event.TargetID, event.SessionID, event.Summary, event.Outcome, createdAt.Format(time.RFC3339Nano))
	return err
}

func ListAuditEvents(db *sql.DB, filter model.AuditFilter) ([]model.AuditEvent, error) {
	query := `SELECT id, action, target_type, target_id, session_id, summary, outcome, created_at FROM audit_events WHERE 1=1`
	arguments := make([]any, 0, 4)
	if filter.Action != "" {
		query += " AND action = ?"
		arguments = append(arguments, filter.Action)
	}
	if filter.SessionID != nil {
		query += " AND session_id = ?"
		arguments = append(arguments, *filter.SessionID)
	}
	if filter.From != "" {
		query += " AND created_at >= ?"
		arguments = append(arguments, filter.From)
	}
	if filter.To != "" {
		query += " AND created_at <= ?"
		arguments = append(arguments, filter.To)
	}
	limit := min(max(filter.Limit, 1), 500)
	query += " ORDER BY id DESC LIMIT ?"
	arguments = append(arguments, limit)
	rows, err := db.Query(query, arguments...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	events := make([]model.AuditEvent, 0)
	for rows.Next() {
		var event model.AuditEvent
		var createdAt string
		if err := rows.Scan(&event.ID, &event.Action, &event.TargetType, &event.TargetID, &event.SessionID, &event.Summary, &event.Outcome, &createdAt); err != nil {
			return nil, err
		}
		event.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
		if err != nil {
			return nil, fmt.Errorf("parse audit event time: %w", err)
		}
		event.Summary = strings.TrimSpace(event.Summary)
		events = append(events, event)
	}
	return events, rows.Err()
}
