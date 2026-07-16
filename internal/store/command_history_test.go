package store

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestCommandHistoryCRUD(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, testCommandSession())
	require.NoError(t, err)
	created, err := AddCommandHistory(db, session.ID, "git status")
	require.NoError(t, err)
	items, err := ListCommandHistory(db, session.ID, "git", 100)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, created.ID, items[0].ID)
	require.NoError(t, DeleteCommandHistory(db, created.ID))
	created, err = AddCommandHistory(db, session.ID, "pwd")
	require.NoError(t, err)
	require.NotZero(t, created.ID)
	require.NoError(t, ClearCommandHistory(db, session.ID))
	items, err = ListCommandHistory(db, session.ID, "", 100)
	require.NoError(t, err)
	require.Empty(t, items)
}

func testCommandSession() model.Session {
	return model.Session{Name: "history", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"}
}
