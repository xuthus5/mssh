package model

type NativeTransparencyStatus struct {
	Supported       bool   `json:"supported"`
	Active          bool   `json:"active"`
	Platform        string `json:"platform"`
	Reason          string `json:"reason"`
	RequiresRestart bool   `json:"requires_restart"`
}
