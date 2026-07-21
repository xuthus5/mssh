package event

const (
	TerminalOutput     = "terminal:output"
	TerminalClosed     = "terminal:closed"
	TransferProgress   = "file:progress"
	TransferComplete   = "file:complete"
	TransferError      = "file:error"
	ConnectionState    = "session:state"
	ConnectionError    = "session:error"
	ConnectionAttempt  = "session:attempt"
	TunnelState        = "tunnel:state"
	HostKeyFingerprint = "session:fingerprint"
	VaultLocked        = "security:vault-locked"
)

type TerminalOutputPayload struct {
	TerminalID string `json:"terminal_id"`
	Sequence   uint64 `json:"sequence"`
	Data       []byte `json:"data"`
}

type ConnectionStatePayload struct {
	TerminalID string `json:"terminal_id"`
	AttemptID  string `json:"attempt_id,omitempty"`
	State      string `json:"state"`
}

type TransferProgressPayload struct {
	TaskID      string  `json:"task_id"`
	Status      string  `json:"status"`
	Transferred int64   `json:"transferred"`
	Total       int64   `json:"total"`
	Percent     float64 `json:"percent"`
	Speed       int64   `json:"speed"`
	ETA         int64   `json:"eta"`
}

type TransferErrorPayload struct {
	TaskID string `json:"task_id"`
	Status string `json:"status"`
	Error  string `json:"error"`
}

type HostKeyPayload struct {
	AttemptID   string `json:"attempt_id"`
	TerminalID  string `json:"terminal_id"`
	Hostname    string `json:"hostname"`
	Fingerprint string `json:"fingerprint"`
	Algorithm   string `json:"algorithm"`
}
