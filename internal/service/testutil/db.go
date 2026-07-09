package testutil

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"

	"mssh/internal/store"
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
