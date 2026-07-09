package model

import "time"

type TunnelType string

const (
	TunnelLocal   TunnelType = "local"
	TunnelRemote  TunnelType = "remote"
	TunnelDynamic TunnelType = "dynamic"
)

type Tunnel struct {
	ID         int64      `json:"id"`
	SessionID  int64      `json:"session_id"`
	Name       string     `json:"name"`
	Type       TunnelType `json:"type"`
	LocalHost  string     `json:"local_host,omitempty"`
	LocalPort  int        `json:"local_port"`
	RemoteHost string     `json:"remote_host,omitempty"`
	RemotePort int        `json:"remote_port"`
	CreatedAt  time.Time  `json:"created_at"`
}
