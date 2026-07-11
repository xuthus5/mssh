package event

const (
	TerminalOutput     = "terminal:output"
	TerminalClosed     = "terminal:closed"
	TransferProgress   = "file:progress"
	TransferComplete   = "file:complete"
	TransferError      = "file:error"
	ConnectionState    = "session:state"
	ConnectionError    = "session:error"
	TunnelState        = "tunnel:state"
	HostKeyFingerprint = "session:fingerprint"
)

type TerminalOutputPayload struct {
	TerminalID string `json:"terminal_id"`
	Data       string `json:"data"`
}

type ConnectionStatePayload struct {
	TerminalID string `json:"terminal_id"`
	State      string `json:"state"`
}

type TransferProgressPayload struct {
	TaskID  string  `json:"task_id"`
	Percent float64 `json:"percent"`
	Speed   int64   `json:"speed"`
	ETA     int64   `json:"eta"`
}

type TransferErrorPayload struct {
	TaskID string `json:"task_id"`
	Error  string `json:"error"`
}

type HostKeyPayload struct {
	TerminalID  string `json:"terminal_id"`
	Hostname    string `json:"hostname"`
	Fingerprint string `json:"fingerprint"`
	Algorithm   string `json:"algorithm"`
}
