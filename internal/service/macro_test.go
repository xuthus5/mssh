package service

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
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
	created, err := svc.Create(model.MacroInputFrom(macro))
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "hello", created.Name)

	macros, err = svc.List()
	require.NoError(t, err)
	assert.Len(t, macros, 1)

	created.Name = "world"
	created.Command = "echo world\n"
	err = svc.Update(model.MacroInputFrom(*created))
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
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	termSvc := NewTerminalService(sessionSvc, newMockEventBus(), 32, testutil.NewTestLogger())
	svc := NewMacroService(db, termSvc, testutil.NewTestLogger())

	err := svc.Execute("nonexistent", "ls\n")
	assert.Error(t, err)
}

func TestMacroService_ExecuteWithTerminal(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())

	addr, cleanup := sshtestutil.NewMockServer(t)
	defer cleanup()
	port := parsePort(t, addr)

	sess := model.Session{
		Name: "test-macro-exec", Host: "127.0.0.1", Port: port, Username: "root",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 30, TermType: "xterm",
	}
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
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
	created, err := svc.Create(model.MacroInputFrom(macro))
	require.NoError(t, err)
	assert.Equal(t, "Ctrl+Shift+C", created.Shortcut)
	assert.Equal(t, 50, created.DelayMs)
	assert.Equal(t, 1, created.SortOrder)
}

func TestMacroService_ExecuteBlocksDangerous(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	termSvc := NewTerminalService(sessionSvc, newMockEventBus(), 32, testutil.NewTestLogger())
	svc := NewMacroService(db, termSvc, testutil.NewTestLogger())
	err := svc.Execute("term", "rm -rf /\n")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestMacroService_ExecuteRejectsOversizedCommand(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewMacroService(db, NewTerminalService(nil, newMockEventBus(), 32, testutil.NewTestLogger()), testutil.NewTestLogger())
	huge := strings.Repeat("a", maxMacroCommandBytes+1)
	err := svc.Execute("term", huge)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "size limit")
}

func TestMacroService_CreateValidatesPayload(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewMacroService(db, nil, testutil.NewTestLogger())
	_, err := svc.Create(model.MacroInputFrom(model.Macro{Name: "", Command: "echo"}))
	require.Error(t, err)
	_, err = svc.Create(model.MacroInputFrom(model.Macro{Name: "x", Command: ""}))
	require.Error(t, err)
	_, err = svc.Create(model.MacroInputFrom(model.Macro{Name: "x", Command: strings.Repeat("a", maxMacroCommandBytes+1)}))
	require.Error(t, err)
	_, err = svc.Create(model.MacroInputFrom(model.Macro{Name: "x", Command: "echo", DelayMs: 70_000}))
	require.Error(t, err)
}

func TestValidateMacroPayloadBounds(t *testing.T) {
	require.Error(t, validateMacroPayload(model.Macro{Name: " ", Command: "echo"}))
	require.Error(t, validateMacroPayload(model.Macro{Name: "ok", Command: " "}))
	require.Error(t, validateMacroPayload(model.Macro{Name: string([]byte{'a', 0}), Command: "echo"}))
	require.Error(t, validateMacroPayload(model.Macro{Name: "ok", Command: string([]byte{'e', 0})}))
	require.Error(t, validateMacroPayload(model.Macro{Name: strings.Repeat("n", maxMacroNameRunes+1), Command: "echo"}))
	require.Error(t, validateMacroPayload(model.Macro{Name: "ok", Command: "echo", Shortcut: strings.Repeat("s", maxMacroShortcutRunes+1)}))
	require.Error(t, validateMacroPayload(model.Macro{Name: "ok", Command: "echo", SortOrder: -1}))
	require.Error(t, validateMacroPayload(model.Macro{Name: "ok", Command: "echo", SortOrder: maxMacroSortOrder + 1}))
	require.Error(t, validateMacroPayload(model.Macro{Name: "ok", Command: strings.Repeat("x", maxMacroCommandBytes+1)}))
	require.NoError(t, validateMacroPayload(model.Macro{Name: "ok", Command: "echo", Shortcut: "Ctrl+1", DelayMs: 10, SortOrder: 1}))
}

func TestMacroService_ExecuteRejectsEmptyTerminalID(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewMacroService(db, nil, testutil.NewTestLogger())
	require.Error(t, svc.Execute("", "ls\n"))
	require.Error(t, svc.Execute("   ", "ls\n"))
}
