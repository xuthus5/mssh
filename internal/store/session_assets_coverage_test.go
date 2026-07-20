package store

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestReplaceSessionTagsDedupAndValidation(t *testing.T) {
	db := setupTestDB(t)
	session, err := CreateSession(db, model.Session{Name: "s", Host: "h", Port: 22, Username: "root", AuthMethod: "password", KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)

	_, err = db.Exec(`INSERT INTO asset_tags (name, name_key, color_token) VALUES ('prod', 'prod', 'blue'), ('dev', 'dev', 'green')`)
	require.NoError(t, err)
	rows, err := db.Query(`SELECT id FROM asset_tags ORDER BY id`)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()
	var ids []int64
	for rows.Next() {
		var id int64
		require.NoError(t, rows.Scan(&id))
		ids = append(ids, id)
	}
	require.Len(t, ids, 2)

	tx, err := db.Begin()
	require.NoError(t, err)
	require.Error(t, replaceSessionTags(tx, session.ID, []int64{0}))
	_ = tx.Rollback()

	tx, err = db.Begin()
	require.NoError(t, err)
	require.NoError(t, replaceSessionTags(tx, session.ID, []int64{ids[0], ids[0], ids[1]}))
	require.NoError(t, tx.Commit())

	sessions, err := ListSessions(db, nil)
	require.NoError(t, err)
	require.NotEmpty(t, sessions)
}
