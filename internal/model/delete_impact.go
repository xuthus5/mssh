package model

type SessionDeleteImpact struct {
	Tunnels    int `json:"tunnels"`
	History    int `json:"history"`
	Recordings int `json:"recordings"`
	Transfers  int `json:"transfers"`
}
