package service

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"modernc.org/sqlite"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSyncSnapshotKeepsCrossTableConsistencyDuringConcurrentWrite(t *testing.T) {
	pauseName := fmt.Sprintf("mssh_snapshot_pause_%d", time.Now().UnixNano())
	entered := make(chan struct{})
	release := make(chan struct{})
	var pauseOnce sync.Once
	var releaseOnce sync.Once
	releaseSnapshot := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(releaseSnapshot)
	require.NoError(t, sqlite.RegisterScalarFunction(pauseName, 0, func(*sqlite.FunctionContext, []driver.Value) (driver.Value, error) {
		pauseOnce.Do(func() {
			close(entered)
			<-release
		})
		return int64(0), nil
	}))

	db := testutil.NewTestDB(t)
	_, err := store.CreateSession(db, model.Session{
		Name: "before", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthAgent, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	require.NoError(t, replaceSessionsTableWithPausedView(db, pauseName))

	writer := openSnapshotWriter(t, db)
	snapshotDone := make(chan snapshotResult, 1)
	go func() {
		data, snapshotErr := NewSyncService(db, testutil.NewTestLogger()).snapshot()
		snapshotDone <- snapshotResult{data: data, err: snapshotErr}
	}()
	requireChannelSignal(t, entered, "snapshot did not reach sessions table")

	writeDone := make(chan error, 1)
	go func() { writeDone <- insertConcurrentSnapshotRows(writer) }()
	select {
	case err = <-writeDone:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("read-only snapshot blocked concurrent WAL writer")
	}
	releaseSnapshot()
	result := requireSnapshotResult(t, snapshotDone)
	require.NoError(t, result.err)
	assertSnapshotReferencesExistingRows(t, result.data)
}

func TestSyncSnapshotReleasesTransactionAfterReadFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	_, err := db.Exec("DROP TABLE macros")
	require.NoError(t, err)

	_, err = NewSyncService(db, testutil.NewTestLogger()).snapshot()
	require.ErrorContains(t, err, "read macros")
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	require.NoError(t, db.PingContext(ctx))
}

type snapshotResult struct {
	data ExportData
	err  error
}

func replaceSessionsTableWithPausedView(db *sql.DB, pauseName string) error {
	if _, err := db.Exec("ALTER TABLE sessions RENAME TO sessions_real"); err != nil {
		return err
	}
	columns := strings.Join([]string{
		"id", "folder_id", "name", "host", "port", "username", "notes", "environment_id", "project_id",
		"auth_method", "password", "key_id", "keep_alive", "term_type", "sort_order", "last_connected_at",
		"connection_count", "created_at", "updated_at",
	}, ", ")
	_, err := db.Exec("CREATE VIEW sessions AS SELECT " + columns + ", " + pauseName + "() AS snapshot_pause FROM sessions_real")
	return err
}

func openSnapshotWriter(t *testing.T, db *sql.DB) *sql.DB {
	t.Helper()
	var sequence int
	var name, path string
	require.NoError(t, db.QueryRow("PRAGMA database_list").Scan(&sequence, &name, &path))
	writer, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(2000)&_pragma=foreign_keys(1)")
	require.NoError(t, err)
	t.Cleanup(func() { _ = writer.Close() })
	return writer
}

func insertConcurrentSnapshotRows(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	session, err := tx.Exec(`INSERT INTO sessions_real (name, host, username, auth_method) VALUES ('after', '127.0.0.2', 'root', 'agent')`)
	if err != nil {
		return err
	}
	sessionID, err := session.LastInsertId()
	if err != nil {
		return err
	}
	tag, err := tx.Exec(`INSERT INTO asset_tags (name, name_key, color_token) VALUES ('after', 'after', 'blue')`)
	if err != nil {
		return err
	}
	tagID, err := tag.LastInsertId()
	if err != nil {
		return err
	}
	if _, err := tx.Exec("INSERT INTO session_tags (session_id, tag_id) VALUES (?, ?)", sessionID, tagID); err != nil {
		return err
	}
	return tx.Commit()
}

func assertSnapshotReferencesExistingRows(t *testing.T, data ExportData) {
	t.Helper()
	sessions := snapshotRowIDs(data.Tables["sessions"])
	tags := snapshotRowIDs(data.Tables["asset_tags"])
	for _, relation := range data.Tables["session_tags"] {
		assert.Contains(t, sessions, int64Value(relation["session_id"]))
		assert.Contains(t, tags, int64Value(relation["tag_id"]))
	}
}

func snapshotRowIDs(rows []map[string]any) map[int64]struct{} {
	ids := make(map[int64]struct{}, len(rows))
	for _, row := range rows {
		ids[int64Value(row["id"])] = struct{}{}
	}
	return ids
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		return 0
	}
}

func requireChannelSignal(t *testing.T, channel <-chan struct{}, message string) {
	t.Helper()
	select {
	case <-channel:
	case <-time.After(2 * time.Second):
		t.Fatal(message)
	}
}

func requireSnapshotResult(t *testing.T, channel <-chan snapshotResult) snapshotResult {
	t.Helper()
	select {
	case result := <-channel:
		return result
	case <-time.After(2 * time.Second):
		t.Fatal("snapshot did not complete")
		return snapshotResult{}
	}
}
