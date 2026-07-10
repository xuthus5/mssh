package ssh

import (
	"context"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
	"mssh/internal/ssh/testutil"
)

func TestOpenPTY(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm-256color"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, "", slog.Default())
	require.NoError(t, err)
	defer cw.Close()
	ptys, err := OpenPTY(cw, s.TermType, 80, 24)
	require.NoError(t, err)
	defer ptys.Close()
	assert.NotNil(t, ptys)
}

func TestOpenPTY_ClosedWrapper(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil, "", slog.Default())
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
	cw, err := Connect(ctx, s, nil, "", slog.Default())
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
	cw, err := Connect(ctx, s, nil, "", slog.Default())
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
	cw, _ := Connect(ctx, s, nil, "", slog.Default())
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
	cw, _ := Connect(ctx, s, nil, "", slog.Default())
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
	time.Sleep(200 * time.Millisecond)
	mu.Lock()
	assert.NotEmpty(t, received)
	mu.Unlock()
}

func TestPTYResize(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test", TermType: "xterm"}
	ctx := context.Background()
	cw, _ := Connect(ctx, s, nil, "", slog.Default())
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
	cw, _ := Connect(ctx, s, nil, "", slog.Default())
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
