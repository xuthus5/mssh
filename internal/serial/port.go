package serial

import (
	"fmt"
	"io"
	"sync"
	"time"

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
	closeOnce    sync.Once
	closeErr     error
	startOnce    sync.Once
	dtr          bool
	rts          bool
}

const maxPendingRead = 1 << 20

// OpenPort opens a serial device using the given profile.
func OpenPort(profile model.SerialPort) (*PortSession, error) {
	mode, err := modeFromProfile(profile)
	if err != nil {
		return nil, err
	}
	port, err := goserial.Open(profile.Device, mode)
	if err != nil {
		return nil, mapOpenError(profile.Device, err)
	}
	if err := port.SetReadTimeout(time.Millisecond * 200); err != nil {
		_ = port.Close()
		return nil, fmt.Errorf("set serial read timeout: %w", err)
	}
	session := &PortSession{
		port:       port,
		device:     CanonicalDevicePath(profile.Device),
		profileID:  profile.ID,
		lineEnding: profile.LineEnding,
		localEcho:  profile.LocalEcho,
		dtr:        profile.DTROnOpen,
		rts:        profile.RTSOnOpen,
	}
	if err := applyFlowControl(port, profile); err != nil {
		_ = port.Close()
		return nil, fmt.Errorf("configure serial flow control: %w", err)
	}
	// Manual DTR/RTS only when the flow mode is not hardware-handshake driven.
	if shouldApplyManualSignals(profile.FlowControl) {
		if err := session.applyInitialSignals(); err != nil {
			_ = port.Close()
			return nil, err
		}
	}
	return session, nil
}

// ListDevices returns system serial device paths (canonicalized).
func ListDevices() ([]string, error) {
	ports, err := goserial.GetPortsList()
	if err != nil {
		return nil, fmt.Errorf("list serial ports: %w", err)
	}
	if ports == nil {
		return []string{}, nil
	}
	return CanonicalDevicePaths(ports), nil
}

func (p *PortSession) Start() {
	p.startOnce.Do(func() {
		go p.readLoop()
	})
}

func (p *PortSession) readLoop() {
	buf := make([]byte, 4096)
	for {
		n, err := p.port.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			p.deliverRead(data)
		}
		if err == nil {
			continue
		}
		if err == io.EOF {
			p.notifyExit(nil)
			return
		}
		p.notifyExit(err)
		return
	}
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
	p.mu.RUnlock()
	if exited || port == nil {
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
	p.closeOnce.Do(func() {
		p.mu.Lock()
		port := p.port
		p.port = nil
		p.mu.Unlock()
		if port != nil {
			p.closeErr = port.Close()
		}
		p.notifyExit(io.EOF)
	})
	return p.closeErr
}

// Device returns the opened device path.
func (p *PortSession) Device() string { return p.device }

// ProfileID returns the serial profile id used to open this session.
func (p *PortSession) ProfileID() int64 { return p.profileID }

// NewTestPortSession builds an offline session handle for lifecycle tests.
func NewTestPortSession(device string) *PortSession {
	return &PortSession{device: device}
}
