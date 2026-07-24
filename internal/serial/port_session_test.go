package serial

import (
	"errors"
	"io"
	"reflect"
	"sync"
	"testing"
	"time"
	"unsafe"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	goserial "go.bug.st/serial"

	"github.com/xuthus5/mssh/internal/model"
)

// fakePort implements goserial.Port for offline PortSession lifecycle tests.
type fakePort struct {
	mu       sync.Mutex
	reads    []readResult
	readIdx  int
	written  []byte
	dtr      bool
	rts      bool
	bits     *goserial.ModemStatusBits
	bitsErr  error
	breakErr error
	writeErr error
	writeN   int
	closed   bool
	closeErr error
	timeout  time.Duration
}

type readResult struct {
	data []byte
	err  error
}

func (f *fakePort) SetMode(*goserial.Mode) error { return nil }

func (f *fakePort) Drain() error { return nil }

func (f *fakePort) ResetInputBuffer() error { return nil }

func (f *fakePort) ResetOutputBuffer() error { return nil }

func (f *fakePort) SetReadTimeout(t time.Duration) error {
	f.timeout = t
	return nil
}

func (f *fakePort) SetDTR(dtr bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return errors.New("closed")
	}
	f.dtr = dtr
	return nil
}

func (f *fakePort) SetRTS(rts bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return errors.New("closed")
	}
	f.rts = rts
	return nil
}

func (f *fakePort) GetModemStatusBits() (*goserial.ModemStatusBits, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.bitsErr != nil {
		return nil, f.bitsErr
	}
	return f.bits, nil
}

func (f *fakePort) Break(time.Duration) error {
	return f.breakErr
}

func (f *fakePort) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	return f.closeErr
}

func (f *fakePort) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.writeErr != nil {
		n := f.writeN
		if n > len(p) {
			n = len(p)
		}
		if n > 0 {
			f.written = append(f.written, p[:n]...)
		}
		return n, f.writeErr
	}
	if f.writeN >= 0 && f.writeN < len(p) && f.writeN > 0 {
		// partial then complete on next call unless zero-byte mode.
		n := f.writeN
		f.written = append(f.written, p[:n]...)
		// subsequent writes succeed fully
		f.writeN = -1
		return n, nil
	}
	if f.writeN == 0 {
		return 0, nil
	}
	f.written = append(f.written, p...)
	return len(p), nil
}

func (f *fakePort) Read(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.readIdx >= len(f.reads) {
		return 0, io.EOF
	}
	item := f.reads[f.readIdx]
	f.readIdx++
	n := copy(p, item.data)
	return n, item.err
}

func newSessionWithPort(port goserial.Port, opts ...func(*PortSession)) *PortSession {
	session := &PortSession{
		port:       port,
		device:     "/dev/ttyTEST",
		profileID:  42,
		lineEnding: model.SerialLineEndingLF,
		localEcho:  false,
		dtr:        true,
		rts:        false,
	}
	for _, opt := range opts {
		opt(session)
	}
	return session
}

func TestPortSessionPendingReadFlushedOnCallback(t *testing.T) {
	port := &fakePort{writeN: -1}
	session := newSessionWithPort(port)
	session.deliverRead([]byte("hello"))
	session.deliverRead([]byte(" world"))

	var got []byte
	done := make(chan struct{})
	session.SetReadCallback(func(data []byte) {
		got = append(got, data...)
		close(done)
	})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("pending read not delivered")
	}
	assert.Equal(t, []byte("hello world"), got)
}

func TestPortSessionPendingReadCapsAtMax(t *testing.T) {
	port := &fakePort{writeN: -1}
	session := newSessionWithPort(port)
	// Fill past maxPendingRead; overflow is dropped.
	chunk := make([]byte, maxPendingRead+64)
	for i := range chunk {
		chunk[i] = 'a'
	}
	session.deliverRead(chunk)
	session.mu.RLock()
	pendingLen := len(session.pendingRead)
	session.mu.RUnlock()
	assert.Equal(t, maxPendingRead, pendingLen)
}

func TestPortSessionWriteLocalEchoAndLineEnding(t *testing.T) {
	port := &fakePort{writeN: -1}
	session := newSessionWithPort(port, func(s *PortSession) {
		s.lineEnding = model.SerialLineEndingCRLF
		s.localEcho = true
	})
	var echoed []byte
	session.SetReadCallback(func(data []byte) { echoed = append(echoed, data...) })

	n, err := session.Write([]byte("hi\n"))
	require.NoError(t, err)
	assert.Equal(t, 3, n)
	assert.Equal(t, []byte("hi\r\n"), port.written)
	assert.Equal(t, []byte("hi\n"), echoed)
	assert.Equal(t, int64(42), session.ProfileID())
	assert.Equal(t, "/dev/ttyTEST", session.Device())
	require.NoError(t, session.Resize(120, 40))
}

func TestPortSessionWriteErrors(t *testing.T) {
	port := &fakePort{writeN: -1, writeErr: errors.New("write failed")}
	session := newSessionWithPort(port)
	_, err := session.Write([]byte("x"))
	require.Error(t, err)

	port2 := &fakePort{writeN: 0}
	session2 := newSessionWithPort(port2)
	_, err = session2.Write([]byte("x"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "zero bytes")

	// partial write then full remainder
	port3 := &fakePort{writeN: 1}
	session3 := newSessionWithPort(port3)
	n, err := session3.Write([]byte("ab"))
	require.NoError(t, err)
	assert.Equal(t, 2, n)
	assert.Equal(t, []byte("ab"), port3.written)
}

func TestPortSessionStartReadLoopEOFAndError(t *testing.T) {
	port := &fakePort{
		writeN: -1,
		reads: []readResult{
			{data: []byte("out")},
			{err: io.EOF},
		},
	}
	session := newSessionWithPort(port)
	var got []byte
	exitCh := make(chan error, 1)
	session.SetReadCallback(func(data []byte) { got = append(got, data...) })
	session.SetExitCallback(func(err error) { exitCh <- err })
	session.Start()
	session.Start() // idempotent

	select {
	case err := <-exitCh:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("exit callback timeout")
	}
	assert.Equal(t, []byte("out"), got)

	// Already-notified exit does not re-fire for a replacement callback.
	fired := false
	session.SetExitCallback(func(error) { fired = true })
	assert.False(t, fired)
}

func TestPortSessionReadLoopNonEOFError(t *testing.T) {
	port := &fakePort{
		writeN: -1,
		reads:  []readResult{{err: errors.New("read boom")}},
	}
	session := newSessionWithPort(port)
	exitCh := make(chan error, 1)
	session.SetExitCallback(func(err error) { exitCh <- err })
	session.Start()
	select {
	case err := <-exitCh:
		require.Error(t, err)
		assert.Contains(t, err.Error(), "read boom")
	case <-time.After(2 * time.Second):
		t.Fatal("exit callback timeout")
	}
}

func TestPortSessionSignalsAndBreak(t *testing.T) {
	port := &fakePort{
		writeN: -1,
		bits:   &goserial.ModemStatusBits{CTS: true, DSR: true, DCD: true, RI: true},
	}
	session := newSessionWithPort(port)
	require.NoError(t, session.SetSignals(false, true))
	assert.False(t, port.dtr)
	assert.True(t, port.rts)

	signals := session.Signals()
	assert.False(t, signals.DTR)
	assert.True(t, signals.RTS)
	assert.True(t, signals.CTS)
	assert.True(t, signals.DSR)
	assert.True(t, signals.DCD)
	assert.True(t, signals.RI)

	require.NoError(t, session.Break(0))             // default duration clamp low
	require.NoError(t, session.Break(5*time.Second)) // clamp high

	port.bitsErr = errors.New("bits unavailable")
	signals = session.Signals()
	assert.False(t, signals.CTS)

	require.NoError(t, session.Close())
	require.Error(t, session.SetSignals(true, true))
	require.Error(t, session.Break(10*time.Millisecond))
	// Signals after close returns cached outputs without modem inputs.
	signals = session.Signals()
	assert.False(t, signals.DTR)
	assert.True(t, signals.RTS)
	assert.False(t, signals.CTS)
}

func TestPortSessionApplyInitialSignals(t *testing.T) {
	port := &fakePort{writeN: -1}
	session := newSessionWithPort(port, func(s *PortSession) {
		s.dtr = true
		s.rts = true
	})
	require.NoError(t, session.applyInitialSignals())
	assert.True(t, port.dtr)
	assert.True(t, port.rts)

	port.closed = true
	require.Error(t, session.applyInitialSignals())
}

func TestPortSessionClosePropagatesErrorAndNotifyOnce(t *testing.T) {
	port := &fakePort{writeN: -1, closeErr: errors.New("close fail")}
	session := newSessionWithPort(port)
	exits := 0
	session.SetExitCallback(func(error) { exits++ })
	err := session.Close()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "close fail")
	// Second close is no-op for closeOnce but returns stored error.
	err = session.Close()
	require.Error(t, err)
	assert.Equal(t, 1, exits)
	_, err = session.Write([]byte("x"))
	require.Error(t, err)
}

func TestMapOpenErrorPortErrorCodes(t *testing.T) {
	// String-based classification paths.
	assert.Contains(t, mapOpenError("/dev/tty", assertErr("ACCESS IS DENIED")).Error(), "permission denied")
	assert.Contains(t, mapOpenError("/dev/tty", assertErr("device in use")).Error(), "busy")
	assert.Contains(t, mapOpenError("/dev/tty", assertErr("weird failure")).Error(), "open serial")
	assert.Nil(t, mapOpenError("/dev/tty", nil))
}

func TestMapParityAndStopBitsAll(t *testing.T) {
	for _, value := range []model.SerialParity{"", model.SerialParityNone, model.SerialParityOdd, model.SerialParityEven, model.SerialParityMark, model.SerialParitySpace} {
		_, err := mapParity(value)
		require.NoError(t, err, value)
	}
	for _, value := range []model.SerialStopBits{"", model.SerialStopBitsOne, model.SerialStopBitsOnePointFive, model.SerialStopBitsTwo} {
		_, err := mapStopBits(value)
		require.NoError(t, err, value)
	}
}

func TestOpenPortSuccessAndErrorPaths(t *testing.T) {
	origOpen := openSerialPort
	origFlow := applyNativeFlow
	t.Cleanup(func() {
		openSerialPort = origOpen
		applyNativeFlow = origFlow
	})

	// Invalid profile fails before open.
	_, err := OpenPort(model.SerialPort{Device: "/dev/ttyUSB0", DataBits: 9})
	require.Error(t, err)

	// Open failure is mapped.
	openSerialPort = func(string, *goserial.Mode) (goserial.Port, error) {
		return nil, assertErr("device busy")
	}
	_, err = OpenPort(model.SerialPort{Device: "/dev/ttyUSB0"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "busy")

	// SetReadTimeout failure closes port.
	openSerialPort = func(string, *goserial.Mode) (goserial.Port, error) {
		return &fakePortReadTimeoutFail{fakePort: fakePort{writeN: -1}}, nil
	}
	_, err = OpenPort(model.SerialPort{Device: "/dev/ttyUSB0"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read timeout")

	// Flow control failure closes port.
	openSerialPort = func(string, *goserial.Mode) (goserial.Port, error) {
		return &fakePort{writeN: -1}, nil
	}
	applyNativeFlow = func(goserial.Port, flowMode, bool, bool) error {
		return errors.New("flow boom")
	}
	_, err = OpenPort(model.SerialPort{Device: "/dev/ttyUSB0", FlowControl: "none"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "flow control")

	// Manual signal failure closes port.
	applyNativeFlow = func(goserial.Port, flowMode, bool, bool) error { return nil }
	openSerialPort = func(string, *goserial.Mode) (goserial.Port, error) {
		return &fakePortSignalFail{fakePort: fakePort{writeN: -1}}, nil
	}
	_, err = OpenPort(model.SerialPort{Device: "/dev/ttyUSB0", FlowControl: "none", DTROnOpen: true})
	require.Error(t, err)

	// Success path with manual signals.
	openSerialPort = func(string, *goserial.Mode) (goserial.Port, error) {
		return &fakePort{writeN: -1}, nil
	}
	session, err := OpenPort(model.SerialPort{
		ID: 7, Device: "/dev/ttyUSB0", FlowControl: "none",
		DTROnOpen: true, RTSOnOpen: false, LocalEcho: true, LineEnding: model.SerialLineEndingLF,
	})
	require.NoError(t, err)
	require.NotNil(t, session)
	assert.Equal(t, int64(7), session.ProfileID())
	assert.True(t, session.localEcho)
	require.NoError(t, session.Close())

	// RTS/CTS skips manual signal re-apply after flow.
	session, err = OpenPort(model.SerialPort{
		ID: 8, Device: "/dev/ttyUSB1", FlowControl: "rtscts",
		DTROnOpen: true, RTSOnOpen: true,
	})
	require.NoError(t, err)
	require.NoError(t, session.Close())
}

type fakePortReadTimeoutFail struct {
	fakePort
	closed bool
}

func (f *fakePortReadTimeoutFail) SetReadTimeout(time.Duration) error {
	return errors.New("timeout unsupported")
}

func (f *fakePortReadTimeoutFail) Close() error {
	f.closed = true
	return nil
}

type fakePortSignalFail struct {
	fakePort
}

func (f *fakePortSignalFail) SetDTR(bool) error { return errors.New("dtr fail") }

func TestListDevicesPaths(t *testing.T) {
	orig := listSerialPorts
	t.Cleanup(func() { listSerialPorts = orig })

	listSerialPorts = func() ([]string, error) {
		return nil, errors.New("enum fail")
	}
	_, err := ListDevices()
	require.Error(t, err)

	listSerialPorts = func() ([]string, error) {
		return nil, nil
	}
	got, err := ListDevices()
	require.NoError(t, err)
	assert.Equal(t, []string{}, got)

	listSerialPorts = func() ([]string, error) {
		return []string{"/dev/ttyUSB0", "/dev/./ttyUSB0"}, nil
	}
	got, err = ListDevices()
	require.NoError(t, err)
	require.Len(t, got, 1)
}

func TestPortSessionStartWithNilPort(t *testing.T) {
	session := NewTestPortSession("/dev/ttyNIL")
	exitCh := make(chan error, 1)
	session.SetExitCallback(func(err error) { exitCh <- err })
	session.Start()
	select {
	case err := <-exitCh:
		assert.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for nil-port exit")
	}
}

func TestPortSessionSetSignalsPartialFailure(t *testing.T) {
	port := &fakePortSignalRTSFail{fakePort: fakePort{writeN: -1}}
	session := newSessionWithPort(port)
	err := session.SetSignals(true, true)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "set RTS")
}

type fakePortSignalRTSFail struct {
	fakePort
}

func (f *fakePortSignalRTSFail) SetRTS(bool) error { return errors.New("rts fail") }

func TestPortSessionApplyInitialSignalsRTSFail(t *testing.T) {
	port := &fakePortSignalRTSFail{fakePort: fakePort{writeN: -1}}
	session := newSessionWithPort(port, func(s *PortSession) { s.dtr = true; s.rts = true })
	require.Error(t, session.applyInitialSignals())
}

func TestNotifyExitIdempotent(t *testing.T) {
	session := NewTestPortSession("/dev/ttyX")
	count := 0
	session.SetExitCallback(func(error) { count++ })
	session.notifyExit(errors.New("first"))
	session.notifyExit(errors.New("second"))
	assert.Equal(t, 1, count)
}

func TestMapOpenErrorTypedPortErrors(t *testing.T) {
	// Construct *PortError via reflection because fields are unexported.
	codes := []struct {
		code    goserial.PortErrorCode
		contain string
	}{
		{goserial.PortBusy, "busy"},
		{goserial.PortNotFound, "not found"},
		{goserial.PermissionDenied, "permission denied"},
		{goserial.InvalidSerialPort, "not a valid serial port"},
		{goserial.InvalidSpeed, "unsupported baud"},
	}
	for _, tc := range codes {
		err := newPortError(tc.code)
		// Ensure errors.As recognizes *PortError.
		var pe *goserial.PortError
		require.True(t, errors.As(err, &pe), "code %v", tc.code)
		got := mapOpenError("/dev/ttyUSB0", err)
		require.Error(t, got)
		assert.Contains(t, got.Error(), tc.contain)
	}
}

func newPortError(code goserial.PortErrorCode) error {
	pe := &goserial.PortError{}
	v := reflect.ValueOf(pe).Elem()
	f := v.FieldByName("code")
	reflect.NewAt(f.Type(), unsafe.Pointer(f.UnsafeAddr())).Elem().Set(reflect.ValueOf(code))
	return pe
}

func TestPortSessionLateExitCallback(t *testing.T) {
	session := NewTestPortSession("/dev/ttyLATE")
	require.NoError(t, session.Close())
	done := make(chan error, 1)
	session.SetExitCallback(func(err error) { done <- err })
	select {
	case err := <-done:
		assert.ErrorIs(t, err, io.EOF)
	case <-time.After(time.Second):
		t.Fatal("late exit callback not delivered")
	}
}
