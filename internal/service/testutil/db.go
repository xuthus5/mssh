package testutil

import (
	"database/sql"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/store"
)

func NewTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	err = store.InitializeSchema(db)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func NewTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func HoldDatabaseConnection(t *testing.T, database *sql.DB) func() {
	t.Helper()
	transaction, err := database.Begin()
	require.NoError(t, err)
	var rollbackOnce sync.Once
	rollback := func() {
		rollbackOnce.Do(func() { require.NoError(t, transaction.Rollback()) })
	}
	t.Cleanup(rollback)
	return rollback
}

func WaitForDatabaseWaitCount(t *testing.T, database *sql.DB, expected int64) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for database.Stats().WaitCount < expected {
		if time.Now().After(deadline) {
			t.Fatalf("database wait count did not reach %d", expected)
		}
		time.Sleep(time.Millisecond)
	}
}
