package service

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	goserial "go.bug.st/serial"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/serial"
	"github.com/xuthus5/mssh/internal/store"
)

func TestOpenSerialRequiresService(t *testing.T) {
	svc := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	_, err := svc.OpenSerial(context.Background(), 1, 80, 24)
	require.Error(t, err)
}

func TestOpenSerialMissingProfile(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	serialSvc := NewSerialService(db, slog.Default())
	term := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	term.SetSerialService(serialSvc)
	_, err = term.OpenSerial(context.Background(), 999, 80, 24)
	require.Error(t, err)
}

func TestSerialServiceListDevicesDoesNotPanic(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	svc := NewSerialService(db, slog.Default())
	_, err = svc.ListDevices()
	if err != nil {
		require.Error(t, err)
	}
	_ = model.SerialPort{}
}

func TestSerialControlRequiresOpenSession(t *testing.T) {
	term := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	_, err := term.SerialSignals("missing")
	require.Error(t, err)
	err = term.SerialSetSignals("missing", true, false)
	require.Error(t, err)
	err = term.SerialBreak("missing", 100)
	require.Error(t, err)
}

func TestEvictLRUReleasesSerialDevice(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })

	serialSvc := NewSerialService(db, slog.Default())
	term := NewTerminalService(nil, discardEventBus{}, 1, slog.Default())
	term.SetSerialService(serialSvc)

	const terminalID = "term-serial-evict"
	device := "/dev/ttyTEST-mssh-evict"
	require.NoError(t, serialSvc.reserveDevice(device, terminalID))

	session := serial.NewTestPortSession(device)
	term.mu.Lock()
	term.ptys[terminalID] = session
	term.lastUsed[terminalID] = time.Now().Add(-time.Minute)
	term.attached[terminalID] = false
	term.mu.Unlock()

	require.Equal(t, terminalID, serialSvc.ActiveDeviceMap()[device])
	term.evictLRU()
	require.Empty(t, serialSvc.ActiveDeviceMap())
	require.Equal(t, 0, term.Count())
}

func TestOpenSerialSuccessAndControl(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })

	serialSvc := NewSerialService(db, slog.Default())
	created, err := serialSvc.Create(model.SerialPortInput{
		Name: "board", Device: "/dev/ttyTEST-open", BaudRate: 115200,
	})
	require.NoError(t, err)

	term := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	term.SetSerialService(serialSvc)

	orig := openSerialPortSession
	t.Cleanup(func() { openSerialPortSession = orig })
	openSerialPortSession = func(profile model.SerialPort) (*serial.PortSession, error) {
		return newLiveSerialSession(profile.Device), nil
	}

	id, err := term.OpenSerial(context.Background(), created.ID, 80, 24)
	require.NoError(t, err)
	require.NotEmpty(t, id)
	t.Cleanup(func() { _ = term.Close(id) })

	// Second open of same device should fail while the live session stays open.
	_, err = term.OpenSerial(context.Background(), created.ID, 80, 24)
	require.Error(t, err)
	require.Contains(t, err.Error(), "already open")

	// Control APIs succeed against a live fake port.
	require.NoError(t, term.SerialSetSignals(id, true, false))
	signals, err := term.SerialSignals(id)
	require.NoError(t, err)
	require.True(t, signals.DTR)
	require.False(t, signals.RTS)
	require.NoError(t, term.SerialBreak(id, 10))
	require.Error(t, term.SerialBreak(id, -1))

	// Non-serial terminal type rejection.
	sshTermID := "not-serial"
	term.mu.Lock()
	term.ptys[sshTermID] = &fakeNonSerialPTY{}
	term.mu.Unlock()
	_, err = term.serialPortSession(sshTermID)
	require.Error(t, err)
	require.Error(t, term.SerialSetSignals(sshTermID, true, true))
}

type fakeNonSerialPTY struct{}

func (f *fakeNonSerialPTY) Start() {}

func (f *fakeNonSerialPTY) Write([]byte) (int, error) { return 0, nil }

func (f *fakeNonSerialPTY) Resize(int, int) error { return nil }

func (f *fakeNonSerialPTY) Close() error { return nil }

func (f *fakeNonSerialPTY) SetReadCallback(func([]byte)) {}

func (f *fakeNonSerialPTY) SetExitCallback(func(error)) {}

func TestOpenSerialOpenPortFailureReleasesDevice(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	serialSvc := NewSerialService(db, slog.Default())
	created, err := serialSvc.Create(model.SerialPortInput{Name: "x", Device: "/dev/ttyTEST-fail"})
	require.NoError(t, err)
	term := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	term.SetSerialService(serialSvc)
	orig := openSerialPortSession
	t.Cleanup(func() { openSerialPortSession = orig })
	openSerialPortSession = func(model.SerialPort) (*serial.PortSession, error) {
		return nil, context.DeadlineExceeded
	}
	_, err = term.OpenSerial(context.Background(), created.ID, 80, 24)
	require.Error(t, err)
	require.Empty(t, serialSvc.ActiveDeviceMap())
}

func TestOpenSerialInvalidSize(t *testing.T) {
	term := NewTerminalService(nil, discardEventBus{}, 8, slog.Default())
	_, err := term.OpenSerial(context.Background(), 1, 0, 0)
	require.Error(t, err)
}

type liveSerialPort struct {
	mu     sync.Mutex
	closed bool
	closeC chan struct{}
	dtr    bool
	rts    bool
}

func newLiveSerialSession(device string) *serial.PortSession {
	return serial.NewLivePortSessionForTest(device, &liveSerialPort{closeC: make(chan struct{})})
}

func (p *liveSerialPort) SetMode(*goserial.Mode) error { return nil }

func (p *liveSerialPort) SetReadTimeout(time.Duration) error { return nil }

func (p *liveSerialPort) Drain() error { return nil }

func (p *liveSerialPort) ResetInputBuffer() error { return nil }

func (p *liveSerialPort) ResetOutputBuffer() error { return nil }

func (p *liveSerialPort) SetDTR(dtr bool) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("closed")
	}
	p.dtr = dtr
	return nil
}

func (p *liveSerialPort) SetRTS(rts bool) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("closed")
	}
	p.rts = rts
	return nil
}

func (p *liveSerialPort) GetModemStatusBits() (*goserial.ModemStatusBits, error) {
	return &goserial.ModemStatusBits{}, nil
}

func (p *liveSerialPort) Break(time.Duration) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return errors.New("closed")
	}
	return nil
}

func (p *liveSerialPort) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return 0, errors.New("closed")
	}
	return len(b), nil
}

func (p *liveSerialPort) Read(_ []byte) (int, error) {
	select {
	case <-p.closeC:
		return 0, io.EOF
	default:
	}
	<-p.closeC
	return 0, io.EOF
}

func (p *liveSerialPort) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	p.closed = true
	close(p.closeC)
	return nil
}
