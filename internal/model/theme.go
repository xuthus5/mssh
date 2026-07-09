package model

import "time"

type Theme struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	IsBuiltin bool      `json:"is_builtin"`
	Config    string    `json:"config"`
	CreatedAt time.Time `json:"created_at"`
}
