package localshell

import (
	"fmt"
	"io"
	"sync"
)

// Session wraps a local interactive shell attached to a PTY/ConPTY.
type Session struct {
	pty          io.ReadWriteCloser
	processWait  func() error
	resizeFn     func(cols, rows int) error
	closeFn      func() error
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

const maxPendingRead = 1 << 20

// Open starts a local shell session with the given options.
func Open(opts Options) (*Session, error) {
	cfg, err := resolveOptions(opts)
	if err != nil {
		return nil, err
	}
	return openPlatform(cfg)
}

func (s *Session) Start() {
	s.startOnce.Do(func() {
		go s.readLoop()
		go s.waitLoop()
	})
}

func (s *Session) readLoop() {
	buf := make([]byte, 4096)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			s.deliverRead(data)
		}
		if err == nil {
			continue
		}
		if err == io.EOF {
			s.notifyExit(nil)
			return
		}
		s.notifyExit(err)
		return
	}
}

func (s *Session) waitLoop() {
	if s.processWait == nil {
		return
	}
	err := s.processWait()
	s.notifyExit(err)
}

func (s *Session) SetReadCallback(fn func([]byte)) {
	s.mu.Lock()
	s.readCb = fn
	pending := s.pendingRead
	s.pendingRead = nil
	s.mu.Unlock()
	if fn != nil && len(pending) > 0 {
		fn(pending)
	}
}

func (s *Session) deliverRead(data []byte) {
	s.mu.Lock()
	callback := s.readCb
	if callback == nil {
		remaining := maxPendingRead - len(s.pendingRead)
		if remaining > 0 {
			if len(data) > remaining {
				data = data[:remaining]
			}
			s.pendingRead = append(s.pendingRead, data...)
		}
	}
	s.mu.Unlock()
	if callback != nil {
		callback(data)
	}
}

func (s *Session) SetExitCallback(fn func(error)) {
	s.mu.Lock()
	s.exitCb = fn
	shouldNotify := s.exited && !s.exitNotified && fn != nil
	if shouldNotify {
		s.exitNotified = true
	}
	exitErr := s.exitErr
	s.mu.Unlock()
	if shouldNotify {
		fn(exitErr)
	}
}

func (s *Session) notifyExit(err error) {
	s.mu.Lock()
	if s.exited {
		s.mu.Unlock()
		return
	}
	s.exited = true
	s.exitErr = err
	callback := s.exitCb
	if callback != nil {
		s.exitNotified = true
	}
	s.mu.Unlock()
	if callback != nil {
		callback(err)
	}
}

func (s *Session) Write(data []byte) (int, error) {
	if s.pty == nil {
		return 0, fmt.Errorf("local shell not available")
	}
	return s.pty.Write(data)
}

func (s *Session) Resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return nil
	}
	if s.resizeFn == nil {
		return nil
	}
	return s.resizeFn(cols, rows)
}

func (s *Session) Close() error {
	s.closeOnce.Do(func() {
		if s.closeFn != nil {
			s.closeErr = s.closeFn()
		} else if s.pty != nil {
			s.closeErr = s.pty.Close()
		}
		s.notifyExit(io.EOF)
	})
	return s.closeErr
}
