package service

// terminalIO is the shared write/resize/close surface for SSH PTY and serial ports.
type terminalIO interface {
	Write(data []byte) (int, error)
	Resize(cols, rows int) error
	Close() error
	SetReadCallback(fn func([]byte))
	SetExitCallback(fn func(error))
	Start()
}
