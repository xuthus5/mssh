package ssh

import (
	"fmt"
	"io"
	"sync"

	gossh "golang.org/x/crypto/ssh"
)

type PTYSession struct {
	session   *gossh.Session
	stdin     io.WriteCloser
	mu        sync.RWMutex
	readCb    func([]byte)
	closeOnce sync.Once
	cancel    chan struct{}
}

func OpenPTY(c *ClientWrapper, termType string, cols, rows int) (*PTYSession, error) {
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
		session.Close()
		return nil, fmt.Errorf("request pty: %w", err)
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	if err := session.Shell(); err != nil {
		session.Close()
		return nil, fmt.Errorf("start shell: %w", err)
	}
	ptys := &PTYSession{session: session, stdin: stdin, cancel: make(chan struct{}, 1)}
	go ptys.readLoop(stdout)
	return ptys, nil
}

func (p *PTYSession) readLoop(r io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			p.mu.RLock()
			cb := p.readCb
			p.mu.RUnlock()
			if cb != nil {
				cb(data)
			}
		}
		if err != nil {
			return
		}
	}
}

func (p *PTYSession) SetReadCallback(fn func([]byte)) {
	p.mu.Lock()
	p.readCb = fn
	p.mu.Unlock()
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
	p.closeOnce.Do(func() { close(p.cancel) })
	return p.session.Close()
}
