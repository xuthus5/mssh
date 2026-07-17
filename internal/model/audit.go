package model

import "time"

type AuditEvent struct {
	ID         int64     `json:"id"`
	Action     string    `json:"action"`
	TargetType string    `json:"target_type"`
	TargetID   string    `json:"target_id"`
	SessionID  *int64    `json:"session_id"`
	Summary    string    `json:"summary"`
	Outcome    string    `json:"outcome"`
	CreatedAt  time.Time `json:"created_at"`
}

type AuditFilter struct {
	Action    string `json:"action"`
	SessionID *int64 `json:"session_id"`
	From      string `json:"from"`
	To        string `json:"to"`
	Limit     int    `json:"limit"`
}
