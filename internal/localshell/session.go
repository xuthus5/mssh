package localshell

import (
	"context"
	"errors"
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
	workers      sync.WaitGroup
	startOnce    sync.Once
	closed       bool
}

const maxPendingRead = 1 << 20

// Open starts a local shell session with the given options.
func Open(opts Options) (*Session, error) {
	return OpenContext(context.Background(), opts)
}

// OpenContext starts a local shell while honoring cancellation during startup.
func OpenContext(ctx context.Context, opts Options) (*Session, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	cfg, err := resolveOptions(opts)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return openPlatformContext(ctx, cfg)
}

func (s *Session) Start() {
	s.startOnce.Do(func() {
		s.mu.Lock()
		if s.closed || s.pty == nil {
			s.mu.Unlock()
			return
		}
		hasProcessWait := s.processWait != nil
		s.workers.Add(1)
		if hasProcessWait {
			s.workers.Add(1)
		}
		s.mu.Unlock()
		go s.runReadLoop()
		if hasProcessWait {
			go s.runWaitLoop()
		}
	})
}

func (s *Session) runReadLoop() {
	exitErr, notify := s.readLoop()
	s.workers.Done()
	if notify {
		s.notifyExit(exitErr)
	}
}

func (s *Session) readLoop() (error, bool) {
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
		if s.processWait != nil {
			_ = s.closeResources()
			return nil, false
		}
		if err == io.EOF {
			return nil, true
		}
		return err, true
	}
}

func (s *Session) runWaitLoop() {
	exitErr := s.waitLoop()
	s.workers.Done()
	s.notifyExit(exitErr)
}

func (s *Session) waitLoop() error {
	if s.processWait == nil {
		return nil
	}
	waitErr := s.processWait()
	cleanupErr := s.closeResources()
	return errors.Join(waitErr, cleanupErr)
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
	if err := validateSize(cols, rows); err != nil {
		return err
	}
	if s.resizeFn == nil {
		return nil
	}
	return s.resizeFn(cols, rows)
}

func (s *Session) Close() error {
	closeErr := s.closeResources()
	s.notifyExit(io.EOF)
	s.workers.Wait()
	return closeErr
}

func (s *Session) closeResources() error {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		s.mu.Unlock()
		if s.closeFn != nil {
			s.closeErr = s.closeFn()
		} else if s.pty != nil {
			s.closeErr = s.pty.Close()
		}
	})
	return s.closeErr
}
