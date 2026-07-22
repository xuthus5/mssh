package service

import (
	"context"
	"log/slog"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func TestOpenLocalShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("local shell conpty covered on windows CI")
	}
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })

	sessionSvc := &SessionService{db: db}
	term := NewTerminalService(sessionSvc, discardEventBus{}, 8, slog.Default())
	id, err := term.OpenLocal(context.Background(), 80, 24)
	require.NoError(t, err)
	require.NotEmpty(t, id)
	require.NoError(t, term.Close(id))
}

func TestLocalShellOptionsReadsSettings(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, store.SetSettings(db, []model.Setting{
		{Key: "terminal.local_shell", Namespace: "terminal", Value: `"/bin/sh"`, ValueType: "string", Version: 1},
		{Key: "terminal.local_shell_args", Namespace: "terminal", Value: `"-i"`, ValueType: "string", Version: 1},
		{Key: "terminal.local_shell_login", Namespace: "terminal", Value: `false`, ValueType: "boolean", Version: 1},
		{Key: "terminal.default_term_type", Namespace: "terminal", Value: `"xterm"`, ValueType: "string", Version: 1},
	}))

	sessionSvc := &SessionService{db: db}
	term := NewTerminalService(sessionSvc, discardEventBus{}, 8, slog.Default())
	opts, err := term.localShellOptions(100, 40)
	require.NoError(t, err)
	require.Equal(t, "/bin/sh", opts.Shell)
	require.Equal(t, []string{"-i"}, opts.Args)
	require.False(t, opts.Login)
	require.Equal(t, "xterm", opts.Term)
	require.Equal(t, 100, opts.Cols)
	require.Equal(t, 40, opts.Rows)
}
