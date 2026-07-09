package event

const (
	TerminalOutput   = "terminal:output"
	TerminalClosed   = "terminal:closed"
	TransferProgress = "file:progress"
	TransferComplete = "file:complete"
	TransferError    = "file:error"
	ConnectionState  = "session:state"
	ConnectionError  = "session:error"
	TunnelState      = "tunnel:state"
)

type TerminalOutputPayload struct {
	TerminalID string `json:"terminal_id"`
	Data       []byte `json:"data"`
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
