package model

import "time"

type Macro struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Command   string    `json:"command"`
	Shortcut  string    `json:"shortcut"`
	DelayMs   int       `json:"delay_ms"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
}
