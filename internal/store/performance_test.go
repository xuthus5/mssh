package store

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

// CI/race budgets (docs/performance-budgets.md). Local target ~250ms / ~2s without -race.
const (
	listThousandSessionsBudget = 750 * time.Millisecond
	transferUpdatesBudget      = 3 * time.Second
)

func TestStorePerformanceBudgets(t *testing.T) {
	db := setupTestDB(t)
	seedSessions(t, db, 1000)
	started := time.Now()
	sessions, err := ListSessions(db, nil)
	require.NoError(t, err)
	require.Len(t, sessions, 1000)
	require.Less(t, time.Since(started), listThousandSessionsBudget)

	job := model.TransferJob{ID: "performance", SessionID: 1, SessionName: "node", Direction: "download", SourcePath: "/remote", TargetPath: "/local", Status: "queued", StartedAt: time.Now()}
	require.NoError(t, CreateTransferJob(db, job))
	started = time.Now()
	for index := int64(0); index < 1000; index++ {
		require.NoError(t, UpdateTransferProgress(db, job.ID, index, 1000, 1024, 1))
	}
	require.Less(t, time.Since(started), transferUpdatesBudget)
}

func BenchmarkCommercialSessionList1000(b *testing.B) {
	db := setupBenchmarkDB(b)
	seedSessions(b, db, 1000)
	b.ResetTimer()
	for range b.N {
		if _, err := ListSessions(db, nil); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkCommercialTransferProgress(b *testing.B) {
	db := setupBenchmarkDB(b)
	job := model.TransferJob{ID: "benchmark", SessionID: 1, SessionName: "node", Direction: "download", SourcePath: "/remote", TargetPath: "/local", Status: "queued", StartedAt: time.Now()}
	require.NoError(b, CreateTransferJob(db, job))
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		if err := UpdateTransferProgress(db, job.ID, int64(index), int64(b.N), 1024, 1); err != nil {
			b.Fatal(err)
		}
	}
}

func seedSessions(t testing.TB, db interface {
	Exec(string, ...any) (sql.Result, error)
}, count int) {
	t.Helper()
	for index := 0; index < count; index++ {
		_, err := db.Exec(`INSERT INTO sessions (folder_id, name, host, username, auth_method) SELECT id, ?, ?, 'root', 'agent' FROM session_folders WHERE is_default = 1`, fmt.Sprintf("node-%04d", index), fmt.Sprintf("10.0.%d.%d", index/255, index%255))
		require.NoError(t, err)
	}
}

func setupBenchmarkDB(b *testing.B) *sql.DB {
	b.Helper()
	db, err := OpenDB(b.TempDir())
	require.NoError(b, err)
	require.NoError(b, InitializeSchema(db))
	b.Cleanup(func() { _ = db.Close() })
	return db
}
