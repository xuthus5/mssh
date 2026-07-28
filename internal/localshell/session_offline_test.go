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

type fakePTY struct {
	mu      sync.Mutex
	reads   []readChunk
	idx     int
	written []byte
	closed  bool
}

type readChunk struct {
	data []byte
	err  error
}

func (f *fakePTY) Read(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.idx >= len(f.reads) {
		return 0, io.EOF
	}
	item := f.reads[f.idx]
	f.idx++
	n := copy(p, item.data)
	return n, item.err
}

func (f *fakePTY) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.written = append(f.written, p...)
	return len(p), nil
}

func (f *fakePTY) Close() error {
	f.closed = true
	return nil
}

func TestLocalSessionPendingReadAndWriteResizeClose(t *testing.T) {
	pty := &fakePTY{}
	session := &Session{
		pty: pty,
		resizeFn: func(cols, rows int) error {
			if cols != 120 || rows != 40 {
				return errors.New("bad size")
			}
			return nil
		},
		closeFn: func() error { return pty.Close() },
		processWait: func() error {
			time.Sleep(10 * time.Millisecond)
			return errors.New("proc exit")
		},
	}
	session.deliverRead([]byte("pending"))
	var got []byte
	done := make(chan struct{})
	session.SetReadCallback(func(data []byte) {
		got = append(got, data...)
		close(done)
	})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("pending timeout")
	}
	assert.Equal(t, []byte("pending"), got)

	// Cap pending buffer.
	session2 := &Session{pty: &fakePTY{}}
	big := make([]byte, maxPendingRead+10)
	session2.deliverRead(big)
	session2.mu.RLock()
	assert.Equal(t, maxPendingRead, len(session2.pendingRead))
	session2.mu.RUnlock()

	n, err := session.Write([]byte("hi"))
	require.NoError(t, err)
	assert.Equal(t, 2, n)
	assert.Equal(t, []byte("hi"), pty.written)
	require.NoError(t, session.Resize(0, 0))
	require.NoError(t, session.Resize(120, 40))
	err = session.Resize(10, 10)
	require.Error(t, err)

	exitCh := make(chan error, 1)
	session.SetExitCallback(func(err error) { exitCh <- err })
	session.Start()
	select {
	case <-exitCh:
	case <-time.After(2 * time.Second):
		t.Fatal("exit timeout")
	}
	assert.True(t, pty.closed)
	require.NoError(t, session.Close())
	assert.True(t, pty.closed)

	// nil pty write
	offline := &Session{}
	_, err = offline.Write([]byte("x"))
	require.Error(t, err)
	require.NoError(t, offline.Resize(80, 24)) // nil resizeFn
	require.NoError(t, offline.Close())
}

func TestLocalSessionReadLoopErrorPaths(t *testing.T) {
	pty := &fakePTY{reads: []readChunk{{data: []byte("out")}, {err: io.EOF}}}
	session := &Session{pty: pty}
	var got []byte
	exitCh := make(chan error, 1)
	session.SetReadCallback(func(data []byte) { got = append(got, data...) })
	session.SetExitCallback(func(err error) { exitCh <- err })
	session.Start()
	select {
	case err := <-exitCh:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}
	assert.Equal(t, []byte("out"), got)

	pty2 := &fakePTY{reads: []readChunk{{err: errors.New("read fail")}}}
	session2 := &Session{pty: pty2}
	exit2 := make(chan error, 1)
	session2.SetExitCallback(func(err error) { exit2 <- err })
	session2.Start()
	select {
	case err := <-exit2:
		require.Error(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}
}

func TestLocalSessionLateExitCallback(t *testing.T) {
	session := &Session{}
	session.notifyExit(errors.New("done"))
	late := make(chan error, 1)
	session.SetExitCallback(func(err error) { late <- err })
	select {
	case err := <-late:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("timeout")
	}
	// second notify ignored
	session.notifyExit(errors.New("again"))
}
