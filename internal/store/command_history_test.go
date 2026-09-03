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

func TestCommandHistoryClosedDatabaseErrors(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())
	_, err := AddCommandHistory(db, 1, "pwd")
	require.Error(t, err)
	_, err = ListCommandHistory(db, 1, "", 10)
	require.Error(t, err)
	require.Error(t, DeleteCommandHistory(db, 1))
	require.Error(t, ClearCommandHistory(db, 1))
}

func TestCommandHistoryRetentionKeepsNewestEntries(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, testCommandSession())
	require.NoError(t, err)
	_, err = db.Exec("WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ?) INSERT INTO command_history (session_id, command) SELECT ?, 'command-' || n FROM seq", commandHistoryRetentionLimit+4, session.ID)
	require.NoError(t, err)
	_, err = AddCommandHistory(db, session.ID, "command-final")
	require.NoError(t, err)
	items, err := ListCommandHistory(db, session.ID, "", commandHistoryRetentionLimit+10)
	require.NoError(t, err)
	require.Len(t, items, commandHistoryRetentionLimit)
	require.Equal(t, "command-final", items[0].Command)
}

func testCommandSession() model.Session {
	return model.Session{Name: "history", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"}
}
