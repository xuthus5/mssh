package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestCommandHistoryService(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	session, err := store.CreateSession(db, model.Session{Name: "history", Host: "localhost", Port: 22, Username: "root", AuthMethod: model.AuthPassword, TermType: "xterm"})
	require.NoError(t, err)
	service := NewCommandHistoryService(db, testutil.NewTestLogger())
	created, err := service.Add(session.ID, "  pwd  ")
	require.NoError(t, err)
	require.Equal(t, "pwd", created.Command)
	items, err := service.List(session.ID, "pwd")
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.NoError(t, service.Delete(created.ID))
	require.NoError(t, service.Clear(session.ID))
}
