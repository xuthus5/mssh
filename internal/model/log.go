package model

import "time"

type RecordType uint32

const (
	RecordStdout RecordType = 0
	RecordStdin  RecordType = 1
)

type SessionLog struct {
	ID        int64      `json:"id"`
	SessionID *int64     `json:"session_id"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
	DataPath  string     `json:"data_path"`
}

type RecordingEntry struct {
	Timestamp int64      `json:"timestamp"`
	Type      RecordType `json:"type"`
	Data      []byte     `json:"data"`
}
