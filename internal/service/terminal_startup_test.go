package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
)

type startupCommandPTY struct {
	writes   [][]byte
	writeErr error
}

func (pty *startupCommandPTY) Write(data []byte) (int, error) {
	pty.writes = append(pty.writes, append([]byte(nil), data...))
	if pty.writeErr != nil {
		return 0, pty.writeErr
	}
	return len(data), nil
}

func (*startupCommandPTY) Resize(int, int) error { return nil }

func (*startupCommandPTY) Close() error { return nil }

func (*startupCommandPTY) SetReadCallback(func([]byte)) {}

func (*startupCommandPTY) SetExitCallback(func(error)) {}

func (*startupCommandPTY) Start() {}

func TestStartupCommandPayload(t *testing.T) {
	tests := []struct {
		name    string
		command string
		want    string
	}{
		{name: "empty", command: "", want: ""},
		{name: "line endings only", command: "\r\n\r\n", want: ""},
		{name: "single line", command: "cd /srv/app", want: "cd /srv/app\n"},
		{name: "trims trailing newlines", command: "whoami\n\n", want: "whoami\n"},
		{name: "normalizes CRLF", command: "cd /srv/app\r\n./run.sh", want: "cd /srv/app\n./run.sh\n"},
		{name: "normalizes CR", command: "first\rsecond", want: "first\nsecond\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.want, startupCommandPayload(test.command))
		})
	}
}

func TestWriteStartupCommand(t *testing.T) {
	pty := &startupCommandPTY{}
	require.NoError(t, writeStartupCommand(pty, "echo ready"))
	require.Len(t, pty.writes, 1)
	assert.Equal(t, "echo ready\n", string(pty.writes[0]))

	empty := &startupCommandPTY{}
	require.NoError(t, writeStartupCommand(empty, "\r\n"))
	assert.Empty(t, empty.writes)

	writeErr := errors.New("write failed")
	require.ErrorIs(t, writeStartupCommand(&startupCommandPTY{writeErr: writeErr}, "whoami"), writeErr)
}

func TestTerminalServiceOpenWritesStartupCommand(t *testing.T) {
	terminal, sessionSvc, sessionID := terminalWithStartupCommand(t, "cd /srv/app && ./run.sh\r\n")
	pty := &startupCommandPTY{}
	replaceOpenPTY(t, func() (terminalIO, error) { return pty, nil })

	terminalID, err := terminal.Open(context.Background(), sessionID, 80, 24)
	require.NoError(t, err)
	t.Cleanup(func() { _ = terminal.Close(terminalID) })
	require.Len(t, pty.writes, 1)
	assert.Equal(t, "cd /srv/app && ./run.sh\n", string(pty.writes[0]))
	assert.Equal(t, 1, sessionSvc.ConnectionCount())
}

func TestTerminalServiceOpenCleansUpWhenStartupCommandFails(t *testing.T) {
	terminal, sessionSvc, sessionID := terminalWithStartupCommand(t, "whoami")
	writeErr := errors.New("write failed")
	replaceOpenPTY(t, func() (terminalIO, error) { return &startupCommandPTY{writeErr: writeErr}, nil })

	_, err := terminal.Open(context.Background(), sessionID, 80, 24)
	require.ErrorContains(t, err, "write startup command")
	require.ErrorIs(t, err, writeErr)
	assert.Zero(t, terminal.Count())
	assert.Zero(t, sessionSvc.ConnectionCount())
}

func terminalWithStartupCommand(t *testing.T, command string) (*TerminalService, *SessionService, int64) {
	t.Helper()
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	address, cleanup := sshtestutil.NewMockServer(t)
	t.Cleanup(cleanup)
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "startup", Host: "127.0.0.1", Port: parsePort(t, address), Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color", StartupCommand: command,
	}))
	require.NoError(t, err)
	return NewTerminalService(sessionSvc, bus, 32, testutil.NewTestLogger()), sessionSvc, created.ID
}

func replaceOpenPTY(t *testing.T, open func() (terminalIO, error)) {
	t.Helper()
	previous := _openPTY
	_openPTY = func(*ssh.ClientWrapper, string, int, int) (terminalIO, error) { return open() }
	t.Cleanup(func() { _openPTY = previous })
}
