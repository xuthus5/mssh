package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
	"mssh/internal/service/testutil"
	sshtestutil "mssh/internal/ssh/testutil"
)

func TestNewMacroService(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewMacroService(db, nil, testutil.NewTestLogger())
	assert.NotNil(t, svc)
}

func TestMacroService_CRUD(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewMacroService(db, nil, testutil.NewTestLogger())

	macros, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, macros, 0)

	macro := model.Macro{Name: "hello", Command: "echo hello\n", Shortcut: "Ctrl+H", DelayMs: 100}
	created, err := svc.Create(macro)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "hello", created.Name)

	macros, err = svc.List()
	require.NoError(t, err)
	assert.Len(t, macros, 1)

	created.Name = "world"
	created.Command = "echo world\n"
	err = svc.Update(*created)
	require.NoError(t, err)

	macros, err = svc.List()
	require.NoError(t, err)
	assert.Equal(t, "world", macros[0].Name)
	assert.Equal(t, "echo world\n", macros[0].Command)

	err = svc.Delete(created.ID)
	require.NoError(t, err)

	macros, err = svc.List()
	require.NoError(t, err)
	assert.Len(t, macros, 0)
}

func TestMacroService_ExecuteNilTerminal(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewMacroService(db, nil, testutil.NewTestLogger())

	err := svc.Execute("nonexistent", "ls\n")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no terminal service")
}

func TestMacroService_ExecuteTerminalNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), testutil.NewTestLogger())
	termSvc := NewTerminalService(sessionSvc, newMockEventBus(), 32, testutil.NewTestLogger())
	svc := NewMacroService(db, termSvc, testutil.NewTestLogger())

	err := svc.Execute("nonexistent", "ls\n")
	assert.Error(t, err)
}

func TestMacroService_ExecuteWithTerminal(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-macro-exec", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm",
	}
	created, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	termSvc := NewTerminalService(sessionSvc, newMockEventBus(), 32, testutil.NewTestLogger())
	ctx := context.Background()
	terminalID, err := termSvc.Open(ctx, created.ID, 80, 24)
	require.NoError(t, err)

	svc := NewMacroService(db, termSvc, testutil.NewTestLogger())

	err = svc.Execute(terminalID, "ls\n")
	require.NoError(t, err)
}

func TestMacroService_CreateWithShortcut(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewMacroService(db, nil, testutil.NewTestLogger())

	macro := model.Macro{Name: "copy", Command: "cp -r\n", Shortcut: "Ctrl+Shift+C", DelayMs: 50, SortOrder: 1}
	created, err := svc.Create(macro)
	require.NoError(t, err)
	assert.Equal(t, "Ctrl+Shift+C", created.Shortcut)
	assert.Equal(t, 50, created.DelayMs)
	assert.Equal(t, 1, created.SortOrder)
}
