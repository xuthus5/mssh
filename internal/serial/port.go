package serial

import (
	"errors"
	"fmt"
	"io"
	"sync"

	goserial "go.bug.st/serial"

	"github.com/xuthus5/mssh/internal/model"
)

// PortSession wraps an open serial port with the same callback surface as SSH PTY.
type PortSession struct {
	port         goserial.Port
	device       string
	profileID    int64
	lineEnding   model.SerialLineEnding
	localEcho    bool
	mu           sync.RWMutex
	readCb       func([]byte)
	pendingRead  []byte
	exitCb       func(error)
	exitErr      error
	exited       bool
	exitNotified bool
	closeMu      sync.Mutex
	closePending bool
	pendingExit  error
	readWG       sync.WaitGroup
	startOnce    sync.Once
	dtr          bool
	rts          bool
}

const maxPendingRead = 1 << 20

func (p *PortSession) Start() {
	notifyUnavailable := false
	p.startOnce.Do(func() {
		p.mu.Lock()
		if p.port == nil {
			p.mu.Unlock()
			notifyUnavailable = true
			return
		}
		p.readWG.Add(1)
		p.mu.Unlock()
		go p.runReadLoop()
	})
	if notifyUnavailable {
		p.notifyExit(nil)
	}
}

func (p *PortSession) runReadLoop() {
	readErr := p.readLoop()
	p.readWG.Done()
	p.finishRead(readErr)
}

func (p *PortSession) readLoop() error {
	buf := make([]byte, 4096)
	for {
		p.mu.RLock()
		port := p.port
		p.mu.RUnlock()
		if port == nil {
			return nil
		}
		n, err := port.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			p.deliverRead(data)
		}
		if err == nil {
			continue
		}
		if err == io.EOF {
			return nil
		}
		return err
	}
}

func (p *PortSession) finishRead(readErr error) {
	p.mu.RLock()
	closePending := p.closePending
	exited := p.exited
	p.mu.RUnlock()
	if closePending {
		if !exited {
			p.storePendingExit(readErr)
		}
		return
	}
	closeErr := p.closeResources()
	if closeErr != nil {
		closeErr = fmt.Errorf("close serial port: %w", closeErr)
		p.storePendingExit(errors.Join(readErr, closeErr))
		return
	}
	p.notifyExit(readErr)
}

func (p *PortSession) storePendingExit(err error) {
	p.mu.Lock()
	if p.exited {
		p.mu.Unlock()
		return
	}
	p.closePending = true
	p.pendingExit = errors.Join(p.pendingExit, err)
	p.mu.Unlock()
}

func (p *PortSession) SetReadCallback(fn func([]byte)) {
	p.mu.Lock()
	p.readCb = fn
	pending := p.pendingRead
	p.pendingRead = nil
	p.mu.Unlock()
	if fn != nil && len(pending) > 0 {
		fn(pending)
	}
}

func (p *PortSession) deliverRead(data []byte) {
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

func (p *PortSession) SetExitCallback(fn func(error)) {
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

func (p *PortSession) notifyExit(err error) {
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

func (p *PortSession) Write(data []byte) (int, error) {
	p.mu.RLock()
	port := p.port
	lineEnding := p.lineEnding
	localEcho := p.localEcho
	exited := p.exited
	closePending := p.closePending
	p.mu.RUnlock()
	if exited || closePending || port == nil {
		return 0, fmt.Errorf("serial port not available")
	}
	payload := transformLineEnding(data, lineEnding)
	written := 0
	for written < len(payload) {
		n, err := port.Write(payload[written:])
		written += n
		if err != nil {
			return written, err
		}
		if n == 0 {
			return written, fmt.Errorf("serial write returned zero bytes")
		}
	}
	if localEcho && len(data) > 0 {
		echo := make([]byte, len(data))
		copy(echo, data)
		p.deliverRead(echo)
	}
	// Report input length so callers can treat line-ending expansion as transparent.
	return len(data), nil
}

// Resize is a no-op for serial ports (no PTY window size).
func (p *PortSession) Resize(cols, rows int) error {
	_, _ = cols, rows
	return nil
}

func (p *PortSession) Close() error {
	p.mu.Lock()
	p.closePending = true
	p.mu.Unlock()
	closeErr := p.closeResources()
	if closeErr != nil {
		return closeErr
	}
	p.mu.Lock()
	exitErr := p.pendingExit
	p.pendingExit = nil
	p.mu.Unlock()
	if exitErr == nil {
		exitErr = io.EOF
	}
	p.notifyExit(exitErr)
	p.readWG.Wait()
	return nil
}

func (p *PortSession) closeResources() error {
	p.closeMu.Lock()
	defer p.closeMu.Unlock()
	p.mu.RLock()
	port := p.port
	p.mu.RUnlock()
	if port == nil {
		return nil
	}
	if err := port.Close(); err != nil {
		return err
	}
	p.mu.Lock()
	if p.port == port {
		p.port = nil
	}
	p.mu.Unlock()
	return nil
}

// Device returns the opened device path.
func (p *PortSession) Device() string { return p.device }

// ProfileID returns the serial profile id used to open this session.
func (p *PortSession) ProfileID() int64 { return p.profileID }

// NewTestPortSession builds an offline session handle for lifecycle tests.
func NewTestPortSession(device string) *PortSession {
	return &PortSession{device: CanonicalDevicePath(device)}
}

// NewLivePortSessionForTest builds a PortSession around an injected port for tests.
func NewLivePortSessionForTest(device string, port goserial.Port) *PortSession {
	return &PortSession{
		port:   port,
		device: CanonicalDevicePath(device),
		dtr:    true,
		rts:    false,
	}
}
