package model

import "time"

type CommandHistory struct {
	ID        int64     `json:"id"`
	SessionID int64     `json:"session_id"`
	Command   string    `json:"command"`
	CreatedAt time.Time `json:"created_at"`
}
