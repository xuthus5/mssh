package testutil

import (
	"database/sql"
	"log/slog"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/store"
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

func NewTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}
