package localshell

import (
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stagedLocalPTY struct {
	started   chan struct{}
	closed    chan struct{}
	finish    chan struct{}
	startOnce sync.Once
	closeOnce sync.Once
	closeErr  error
}

func newStagedLocalPTY() *stagedLocalPTY {
	return &stagedLocalPTY{
		started: make(chan struct{}),
		closed:  make(chan struct{}),
		finish:  make(chan struct{}),
	}
}

func (p *stagedLocalPTY) Read([]byte) (int, error) {
	p.startOnce.Do(func() { close(p.started) })
	<-p.closed
	<-p.finish
	return 0, io.EOF
}

func (p *stagedLocalPTY) Write(content []byte) (int, error) { return len(content), nil }

func (p *stagedLocalPTY) Close() error {
	p.closeOnce.Do(func() { close(p.closed) })
	return p.closeErr
}

func TestLocalSessionCloseWaitsForReadLoop(t *testing.T) {
	pty := newStagedLocalPTY()
	closeFailure := errors.New("close local PTY")
	pty.closeErr = closeFailure
	session := &Session{pty: pty, closeFn: pty.Close}
	session.Start()
	<-pty.started
	result := make(chan error, 1)
	go func() { result <- session.Close() }()
	<-pty.closed

	var closeErr error
	returnedEarly := false
	select {
	case closeErr = <-result:
		returnedEarly = true
	case <-time.After(20 * time.Millisecond):
	}
	close(pty.finish)
	if !returnedEarly {
		closeErr = <-result
	}

	assert.False(t, returnedEarly, "local shell close returned before its read loop exited")
	require.ErrorIs(t, closeErr, closeFailure)
}

func TestLocalSessionCloseWaitsForProcessWait(t *testing.T) {
	waitStarted := make(chan struct{})
	waitRelease := make(chan struct{})
	closeCalled := make(chan struct{})
	var closeOnce sync.Once
	session := &Session{
		pty: &fakePTY{},
		processWait: func() error {
			close(waitStarted)
			<-waitRelease
			return nil
		},
		closeFn: func() error {
			closeOnce.Do(func() { close(closeCalled) })
			return nil
		},
	}
	session.Start()
	<-waitStarted
	<-closeCalled
	result := make(chan error, 1)
	go func() { result <- session.Close() }()

	returnedEarly := false
	select {
	case <-result:
		returnedEarly = true
	case <-time.After(20 * time.Millisecond):
	}
	close(waitRelease)
	if !returnedEarly {
		require.NoError(t, <-result)
	}
	assert.False(t, returnedEarly, "local shell close returned before process wait exited")
}

func TestLocalSessionClosePreventsLateWorkers(t *testing.T) {
	pty := newStagedLocalPTY()
	session := &Session{pty: pty, closeFn: pty.Close}
	require.NoError(t, session.Close())
	session.Start()

	started := false
	select {
	case <-pty.started:
		started = true
	case <-time.After(20 * time.Millisecond):
	}
	close(pty.finish)
	assert.False(t, started, "local shell worker started after close")
}

func TestLocalSessionExitCallbackMayCloseSession(t *testing.T) {
	session := &Session{pty: &fakePTY{}}
	result := make(chan error, 1)
	session.SetExitCallback(func(error) { result <- session.Close() })
	session.Start()

	select {
	case closeErr := <-result:
		require.NoError(t, closeErr)
	case <-time.After(time.Second):
		t.Fatal("local shell exit callback deadlocked while closing the session")
	}
}
