package ssh

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func TestOpenPTY(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm-256color"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	defer cw.Close()
	ptys, err := OpenPTY(cw, s.TermType, 80, 24)
	require.NoError(t, err)
	defer ptys.Close()
	assert.NotNil(t, ptys)
}

func TestPreparePTYStartsReadingOnlyAfterStart(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	session := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm-256color"}
	client, err := Connect(context.Background(), session, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	defer client.Close()
	pty, err := PreparePTY(client, session.TermType, 80, 24)
	require.NoError(t, err)
	defer pty.Close()
	received := make(chan string, 1)
	pty.SetReadCallback(func(data []byte) { received <- string(data) })

	assert.Never(t, func() bool { return len(received) > 0 }, 50*time.Millisecond, 10*time.Millisecond)
	pty.Start()
	pty.Start()

	require.Eventually(t, func() bool { return len(received) > 0 }, 2*time.Second, 10*time.Millisecond)
}

func TestOpenPTY_ClosedWrapper(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	cw.Close()
	_, err = OpenPTY(cw, s.TermType, 80, 24)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "new session")
}

func TestOpenPTY_RejectPty(t *testing.T) {
	addr, cleanup := testutil.NewMockServerRejectPty(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	defer cw.Close()
	_, err = OpenPTY(cw, s.TermType, 80, 24)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "request pty")
}

func TestOpenPTY_RejectShell(t *testing.T) {
	addr, cleanup := testutil.NewMockServerRejectShell(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	require.NoError(t, err)
	defer cw.Close()
	_, err = OpenPTY(cw, s.TermType, 80, 24)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "start shell")
}

func TestPTYWrite(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, _ := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	defer cw.Close()
	ptys, _ := OpenPTY(cw, s.TermType, 80, 24)
	defer ptys.Close()
	n, err := ptys.Write([]byte("ls\n"))
	require.NoError(t, err)
	assert.Equal(t, 3, n)
}

func TestPTYReadCallback(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, _ := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	defer cw.Close()
	ptys, _ := OpenPTY(cw, s.TermType, 80, 24)
	defer ptys.Close()
	var mu sync.Mutex
	var received [][]byte
	ptys.SetReadCallback(func(data []byte) {
		mu.Lock()
		received = append(received, data)
		mu.Unlock()
	})
	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(received) > 0
	}, 2*time.Second, 10*time.Millisecond)
}

func TestPTYExitCallbackObservesEOFWhenRegisteredAfterReadLoop(t *testing.T) {
	pty := &PTYSession{}
	pty.readLoop(bytes.NewReader(nil))

	exited := make(chan error, 1)
	pty.SetExitCallback(func(err error) { exited <- err })

	assert.ErrorIs(t, <-exited, io.EOF)
}

func TestPTYExitCallbackRunsOnceWhenReadLoopCompletes(t *testing.T) {
	pty := &PTYSession{}
	exited := make(chan error, 2)
	pty.SetExitCallback(func(err error) { exited <- err })

	pty.readLoop(bytes.NewReader(nil))
	pty.notifyExit(io.ErrClosedPipe)

	assert.ErrorIs(t, <-exited, io.EOF)
	assert.Empty(t, exited)
}

func TestPTYReadCallbackReceivesOutputBufferedBeforeRegistration(t *testing.T) {
	pty := &PTYSession{}
	pty.readLoop(bytes.NewBufferString("early output"))

	received := make(chan string, 1)
	pty.SetReadCallback(func(data []byte) { received <- string(data) })

	assert.Equal(t, "early output", <-received)
}

func TestPTYResize(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, _ := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	defer cw.Close()
	ptys, _ := OpenPTY(cw, s.TermType, 80, 24)
	defer ptys.Close()
	err := ptys.Resize(120, 40)
	require.NoError(t, err)
}

func TestPTYCloseDouble(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, _ := Connect(ctx, s, nil, testutil.KnownHostsPath(t), slog.Default())
	defer cw.Close()
	ptys, _ := OpenPTY(cw, s.TermType, 80, 24)
	err := ptys.Close()
	require.NoError(t, err)
	assert.NotPanics(t, func() { _ = ptys.Close() })
}

func TestPTYWrite_NilStdin(t *testing.T) {
	p := &PTYSession{stdin: nil}
	n, err := p.Write([]byte("data"))
	assert.Error(t, err)
	assert.Equal(t, 0, n)
	assert.Contains(t, err.Error(), "stdin not available")
}
