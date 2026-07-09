package testutil

import (
	"database/sql"
	"testing"

	"mssh/internal/store"

	"github.com/stretchr/testify/require"
)

func NewTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	err = store.Migrate(db)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}
