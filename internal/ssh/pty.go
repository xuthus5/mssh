package ssh

import (
	"fmt"
	"io"
	"sync"

	gossh "golang.org/x/crypto/ssh"
)

const maxPendingRead = 1 << 20 // 1 MiB pre-callback buffer

type PTYSession struct {
	session      *gossh.Session
	stdin        io.WriteCloser
	stdout       io.Reader
	mu           sync.RWMutex
	readCb       func([]byte)
	pendingRead  []byte
	exitCb       func(error)
	exitErr      error
	exited       bool
	exitNotified bool
	closeOnce    sync.Once
	closeErr     error
	startOnce    sync.Once
}

func OpenPTY(c *ClientWrapper, termType string, cols, rows int) (*PTYSession, error) {
	pty, err := PreparePTY(c, termType, cols, rows)
	if err != nil {
		return nil, err
	}
	pty.Start()
	return pty, nil
}

func PreparePTY(c *ClientWrapper, termType string, cols, rows int) (*PTYSession, error) {
	session, err := c.Inner.NewSession()
	if err != nil {
		return nil, fmt.Errorf("new session: %w", err)
	}
	modes := gossh.TerminalModes{
		gossh.ECHO:          1,
		gossh.TTY_OP_ISPEED: 14400,
		gossh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty(termType, rows, cols, modes); err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("request pty: %w", err)
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	if err := session.Shell(); err != nil {
		_ = session.Close()
		return nil, fmt.Errorf("start shell: %w", err)
	}
	return &PTYSession{session: session, stdin: stdin, stdout: stdout}, nil
}

func (p *PTYSession) Start() {
	p.startOnce.Do(func() {
		if p.stdout != nil {
			go p.readLoop(p.stdout)
		}
	})
}

func (p *PTYSession) readLoop(r io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			p.deliverRead(data)
		}
		if err != nil {
			p.notifyExit(err)
			return
		}
	}
}

func (p *PTYSession) SetReadCallback(fn func([]byte)) {
	p.mu.Lock()
	p.readCb = fn
	pending := p.pendingRead
	p.pendingRead = nil
	p.mu.Unlock()
	if fn != nil && len(pending) > 0 {
		fn(pending)
	}
}

func (p *PTYSession) deliverRead(data []byte) {
	p.mu.Lock()
	callback := p.readCb
	if callback == nil {
		remaining := maxPendingRead - len(p.pendingRead)
		if remaining > 0 {
			if len(data) > remaining {
				data = data[:remaining]
			}
			p.pendingRead = append(p.pendingRead, data...)
		}
	}
	p.mu.Unlock()
	if callback != nil {
		callback(data)
	}
}

func (p *PTYSession) SetExitCallback(fn func(error)) {
	p.mu.Lock()
	p.exitCb = fn
	shouldNotify := p.exited && !p.exitNotified && fn != nil
	if shouldNotify {
		p.exitNotified = true
	}
	exitErr := p.exitErr
	p.mu.Unlock()
	if shouldNotify {
		fn(exitErr)
	}
}

func (p *PTYSession) notifyExit(err error) {
	p.mu.Lock()
	if p.exited {
		p.mu.Unlock()
		return
	}
	p.exited = true
	p.exitErr = err
	callback := p.exitCb
	if callback != nil {
		p.exitNotified = true
	}
	p.mu.Unlock()
	if callback != nil {
		callback(err)
	}
}

func (p *PTYSession) Write(data []byte) (int, error) {
	if p.stdin == nil {
		return 0, fmt.Errorf("stdin not available")
	}
	return p.stdin.Write(data)
}

func (p *PTYSession) Resize(cols, rows int) error {
	return p.session.WindowChange(rows, cols)
}

func (p *PTYSession) Close() error {
	p.closeOnce.Do(func() {
		if p.session != nil {
			p.closeErr = p.session.Close()
		}
	})
	return p.closeErr
}
