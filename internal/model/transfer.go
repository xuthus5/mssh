package model

import "time"

type TransferJob struct {
	ID               string     `json:"id"`
	SessionID        int64      `json:"session_id"`
	SessionName      string     `json:"session_name"`
	Direction        string     `json:"direction"`
	SourcePath       string     `json:"source_path"`
	TargetPath       string     `json:"target_path"`
	TotalBytes       int64      `json:"total_bytes"`
	TransferredBytes int64      `json:"transferred_bytes"`
	Speed            int64      `json:"speed"`
	ETA              int64      `json:"eta"`
	Status           string     `json:"status"`
	Error            string     `json:"error,omitempty"`
	StartedAt        time.Time  `json:"started_at"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
}
