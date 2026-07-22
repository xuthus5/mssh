package store

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestUpdateSessionWithTagsRoundTrip(t *testing.T) {
	db := setupTestDB(t)
	created, err := CreateSession(db, model.Session{
		Name: "s1", Host: "h", Port: 22, Username: "u", AuthMethod: model.AuthPassword,
		KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	// create tag via SQL if helper missing
	result, err := db.Exec(`INSERT INTO asset_tags (name, name_key, color_token) VALUES ('t1','t1','slate')`)
	require.NoError(t, err)
	tagID, err := result.LastInsertId()
	require.NoError(t, err)
	created.Name = "s1-updated"
	require.NoError(t, UpdateSessionWithTags(db, *created, []int64{tagID}))
	got, err := GetSession(db, created.ID)
	require.NoError(t, err)
	require.Equal(t, "s1-updated", got.Name)
}
