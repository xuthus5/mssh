package model

import "time"

type AuthMethod string

const (
	AuthPassword            AuthMethod = "password"
	AuthKey                 AuthMethod = "key"
	AuthAgent               AuthMethod = "agent"
	AuthKeyboardInteractive AuthMethod = "keyboard-interactive"
)

type SessionFolder struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	ParentID  *int64    `json:"parent_id"`
	IsDefault bool      `json:"is_default"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Session struct {
	ID              int64      `json:"id"`
	FolderID        *int64     `json:"folder_id"`
	Name            string     `json:"name"`
	Host            string     `json:"host"`
	Port            int        `json:"port"`
	Username        string     `json:"username"`
	AuthMethod      AuthMethod `json:"auth_method"`
	Password        string     `json:"password,omitempty"`
	KeyID           *int64     `json:"key_id,omitempty"`
	KeepAlive       int        `json:"keep_alive"`
	TermType        string     `json:"term_type"`
	SortOrder       int        `json:"sort_order"`
	LastConnectedAt *time.Time `json:"last_connected_at,omitempty"`
	ConnectionCount int        `json:"connection_count"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}
