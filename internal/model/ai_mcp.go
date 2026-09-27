package model

// AIMCPServerSettings configures the user-started, loopback-only MCP endpoint
// that external CLI tools connect to.
type AIMCPServerSettings struct {
	SessionID int64 `json:"session_id"`
	Port      int   `json:"port"`
}

type AIMCPServerInput struct {
	SessionID int64 `json:"session_id"`
	Port      int   `json:"port"`
}

type AIMCPServerStatus struct {
	Running     bool   `json:"running"`
	URL         string `json:"url"`
	Token       string `json:"token"`
	SessionID   int64  `json:"session_id"`
	SessionName string `json:"session_name"`
	Port        int    `json:"port"`
}
