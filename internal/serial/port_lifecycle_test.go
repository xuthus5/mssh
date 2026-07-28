package serial

import (
	"io"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stagedSerialPort struct {
	fakePort
	started   chan struct{}
	closed    chan struct{}
	finish    chan struct{}
	startOnce sync.Once
	closeOnce sync.Once
}

func newStagedSerialPort() *stagedSerialPort {
	return &stagedSerialPort{
		fakePort: fakePort{writeN: -1},
		started:  make(chan struct{}),
		closed:   make(chan struct{}),
		finish:   make(chan struct{}),
	}
}

func (p *stagedSerialPort) Read([]byte) (int, error) {
	p.startOnce.Do(func() { close(p.started) })
	<-p.closed
	<-p.finish
	return 0, io.EOF
}

func (p *stagedSerialPort) Close() error {
	p.closeOnce.Do(func() { close(p.closed) })
	return nil
}

func TestPortSessionCloseWaitsForReadLoop(t *testing.T) {
	port := newStagedSerialPort()
	session := newSessionWithPort(port)
	session.Start()
	<-port.started
	result := make(chan error, 1)
	go func() { result <- session.Close() }()
	<-port.closed

	var closeErr error
	returnedEarly := false
	select {
	case closeErr = <-result:
		returnedEarly = true
	case <-time.After(20 * time.Millisecond):
	}
	close(port.finish)
	if !returnedEarly {
		closeErr = <-result
	}

	assert.False(t, returnedEarly, "serial close returned before its read loop exited")
	require.NoError(t, closeErr)
}

func TestPortSessionExitCallbackMayCloseSession(t *testing.T) {
	session := newSessionWithPort(&fakePort{writeN: -1})
	result := make(chan error, 1)
	session.SetExitCallback(func(error) { result <- session.Close() })
	session.Start()

	select {
	case closeErr := <-result:
		require.NoError(t, closeErr)
	case <-time.After(time.Second):
		t.Fatal("serial exit callback deadlocked while closing the session")
	}
}
