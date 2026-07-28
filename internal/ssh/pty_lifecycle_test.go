package ssh

import (
	"bytes"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stagedPTYReader struct {
	started   chan struct{}
	release   chan struct{}
	startOnce sync.Once
}

func newStagedPTYReader() *stagedPTYReader {
	return &stagedPTYReader{started: make(chan struct{}), release: make(chan struct{})}
}

func (r *stagedPTYReader) Read([]byte) (int, error) {
	r.startOnce.Do(func() { close(r.started) })
	<-r.release
	return 0, io.EOF
}

func TestPTYCloseWaitsForReadLoop(t *testing.T) {
	reader := newStagedPTYReader()
	pty := &PTYSession{stdout: reader}
	pty.Start()
	<-reader.started
	result := make(chan error, 1)
	go func() { result <- pty.Close() }()

	var closeErr error
	returnedEarly := false
	select {
	case closeErr = <-result:
		returnedEarly = true
	case <-time.After(20 * time.Millisecond):
	}
	close(reader.release)
	if !returnedEarly {
		closeErr = <-result
	}

	assert.False(t, returnedEarly, "PTY close returned before its read loop exited")
	require.NoError(t, closeErr)
}

func TestPTYClosePreventsLateReadLoopStart(t *testing.T) {
	reader := newStagedPTYReader()
	pty := &PTYSession{stdout: reader}
	require.NoError(t, pty.Close())
	pty.Start()

	started := false
	select {
	case <-reader.started:
		started = true
	case <-time.After(20 * time.Millisecond):
	}
	close(reader.release)
	assert.False(t, started, "PTY read loop started after close")
}

func TestPTYExitCallbackMayCloseSession(t *testing.T) {
	pty := &PTYSession{stdout: bytes.NewReader(nil)}
	result := make(chan error, 1)
	pty.SetExitCallback(func(error) { result <- pty.Close() })
	pty.Start()

	select {
	case closeErr := <-result:
		require.NoError(t, closeErr)
	case <-time.After(time.Second):
		t.Fatal("PTY exit callback deadlocked while closing the session")
	}
}
