package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestInsertRowUsesTableAndColumnAllowList(t *testing.T) {
	db := testutil.NewTestDB(t)
	tx, err := db.Begin()
	require.NoError(t, err)

	err = insertRow(tx, "session_folders; DROP TABLE sessions", map[string]any{"id": int64(100)})
	require.ErrorContains(t, err, "unsupported snapshot table")
	err = insertRow(tx, "session_folders", map[string]any{"id": int64(100), "name); DROP TABLE sessions; --": "bad"})
	require.ErrorContains(t, err, "unsupported column")
	err = insertRow(tx, "session_folders", map[string]any{})
	require.ErrorContains(t, err, "is empty")

	require.NoError(t, tx.Rollback())
	var tables int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").Scan(&tables))
	require.Equal(t, 1, tables)
}

func TestInsertRowAcceptsKnownColumns(t *testing.T) {
	db := testutil.NewTestDB(t)
	tx, err := db.Begin()
	require.NoError(t, err)
	err = insertRow(tx, "session_folders", map[string]any{
		"id": int64(100), "name": "imported", "parent_id": nil, "is_default": int64(0),
		"sort_order": int64(1), "created_at": "2026-01-01 00:00:00", "updated_at": "2026-01-01 00:00:00",
	})
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	var name string
	require.NoError(t, db.QueryRow("SELECT name FROM session_folders WHERE id = 100").Scan(&name))
	require.Equal(t, "imported", name)
}
