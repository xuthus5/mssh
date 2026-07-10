package ssh

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

type PTY interface {
	SetReadCallback(func([]byte))
	Write(data []byte) (int, error)
	Resize(cols, rows int) error
	Close() error
}

type NativePTY struct {
	stdin  io.WriteCloser
	stdout io.ReadCloser
	mu     sync.RWMutex
	readCb func([]byte)
	cancel chan struct{}
	cmd    *exec.Cmd
}

func OpenNativePTY(host string, port int, user, password string, _cols, _rows int) (PTY, error) {
	args := []string{
		"-tt",
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "PreferredAuthentications=password",
		"-o", "PubkeyAuthentication=no",
		"-o", "NumberOfPasswordPrompts=1",
		"-p", fmt.Sprint(port),
		fmt.Sprintf("%s@%s", user, host),
	}
	cmd := exec.Command("ssh", args...)
	cmd.Env = append(os.Environ(), "SSH_ASKPASS=", "SSH_ASKPASS_REQUIRE=never")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("native pty stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("native pty stdout: %w", err)
	}
	_, _ = cmd.StderrPipe() // discard stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("native pty start: %w", err)
	}

	_, _ = io.WriteString(stdin, password+"\n")

	p := &NativePTY{
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		cancel: make(chan struct{}),
	}
	go p.readLoop()
	return p, nil
}

func (p *NativePTY) readLoop() {
	buf := make([]byte, 4096)
	for {
		select {
		case <-p.cancel:
			return
		default:
		}
		n, err := p.stdout.Read(buf)
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

func (p *NativePTY) SetReadCallback(fn func([]byte)) {
	p.mu.Lock()
	p.readCb = fn
	p.mu.Unlock()
}

func (p *NativePTY) Write(data []byte) (int, error) {
	return p.stdin.Write(data)
}

func (p *NativePTY) Resize(_cols, _rows int) error { return nil }

func (p *NativePTY) Close() error {
	close(p.cancel)
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	return nil
}
