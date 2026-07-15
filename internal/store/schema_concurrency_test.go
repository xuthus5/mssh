package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"modernc.org/sqlite"
)

var schemaBarrierDriverID atomic.Uint64

func TestInitializeSchemaConcurrentHandlesPreserveFinalData(t *testing.T) {
	barrier := newTransactionBeginBarrier()
	driverName := fmt.Sprintf("sqlite_schema_barrier_test_%d", schemaBarrierDriverID.Add(1))
	sql.Register(driverName, &beginBarrierDriver{
		Driver:  &sqlite.Driver{},
		barrier: barrier,
	})
	defer barrier.releaseSecondInitializer()

	dbPath := filepath.Join(t.TempDir(), "mssh.db")
	firstDB := openBarrierDB(t, driverName, dbPath)
	secondDB := openBarrierDB(t, driverName, dbPath)

	firstResult := make(chan error, 1)
	go func() { firstResult <- InitializeSchema(firstDB) }()
	barrier.waitForFirstInitializer(t)

	secondResult := make(chan error, 1)
	go func() { secondResult <- InitializeSchema(secondDB) }()

	require.NoError(t, waitForInitializeResult(t, firstResult))
	insertFinalSchemaSentinel(t, firstDB)
	barrier.releaseSecondInitializer()
	require.NoError(t, waitForInitializeResult(t, secondResult))

	assertConcurrentSentinelCount(t, firstDB, 1)
	assertConcurrentDatabaseVersion(t, firstDB, databaseFormatVersion)
	assert.Equal(t, 2, barrier.beginCount())
}

func assertConcurrentSentinelCount(t *testing.T, db *sql.DB, expected int) {
	t.Helper()
	var actual int
	require.NoError(t, db.QueryRow(
		"SELECT count(*) FROM sessions WHERE name = 'concurrent-sentinel'",
	).Scan(&actual))
	assert.Equal(t, expected, actual)
}

func assertConcurrentDatabaseVersion(t *testing.T, db *sql.DB, expected int) {
	t.Helper()
	var actual int
	require.NoError(t, db.QueryRow("PRAGMA user_version").Scan(&actual))
	assert.Equal(t, expected, actual)
}

func openBarrierDB(t *testing.T, driverName, dbPath string) *sql.DB {
	t.Helper()
	dsn := dbPath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate"
	db, err := sql.Open(driverName, dsn)
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	require.NoError(t, db.Ping())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func insertFinalSchemaSentinel(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO sessions (folder_id, name, host, username, auth_method)
		SELECT id, 'concurrent-sentinel', '127.0.0.1', 'root', 'agent'
		FROM session_folders WHERE is_default = 1`)
	require.NoError(t, err)
}

func waitForInitializeResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for schema initialization")
		return nil
	}
}

type beginBarrierDriver struct {
	driver.Driver
	barrier *transactionBeginBarrier
}

func (wrapped *beginBarrierDriver) Open(name string) (driver.Conn, error) {
	connection, err := wrapped.Driver.Open(name)
	if err != nil {
		return nil, err
	}
	return &beginBarrierConn{Conn: connection, barrier: wrapped.barrier}, nil
}

type beginBarrierConn struct {
	driver.Conn
	barrier *transactionBeginBarrier
}

func (connection *beginBarrierConn) BeginTx(
	ctx context.Context,
	options driver.TxOptions,
) (driver.Tx, error) {
	if err := connection.barrier.beforeBegin(ctx); err != nil {
		return nil, err
	}
	beginner, ok := connection.Conn.(driver.ConnBeginTx)
	if !ok {
		return nil, errors.New("sqlite connection does not support BeginTx")
	}
	return beginner.BeginTx(ctx, options)
}

type transactionBeginBarrier struct {
	mu            sync.Mutex
	calls         int
	firstStarted  chan struct{}
	bothStarted   chan struct{}
	releaseSecond chan struct{}
	releaseOnce   sync.Once
}

func newTransactionBeginBarrier() *transactionBeginBarrier {
	return &transactionBeginBarrier{
		firstStarted:  make(chan struct{}),
		bothStarted:   make(chan struct{}),
		releaseSecond: make(chan struct{}),
	}
}

func (barrier *transactionBeginBarrier) beforeBegin(ctx context.Context) error {
	call := barrier.recordBegin()
	var waitFor <-chan struct{}
	switch call {
	case 1:
		waitFor = barrier.bothStarted
	case 2:
		waitFor = barrier.releaseSecond
	default:
		return errors.New("unexpected extra transaction")
	}
	select {
	case <-waitFor:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (barrier *transactionBeginBarrier) recordBegin() int {
	barrier.mu.Lock()
	defer barrier.mu.Unlock()
	barrier.calls++
	switch barrier.calls {
	case 1:
		close(barrier.firstStarted)
	case 2:
		close(barrier.bothStarted)
	}
	return barrier.calls
}

func (barrier *transactionBeginBarrier) waitForFirstInitializer(t *testing.T) {
	t.Helper()
	select {
	case <-barrier.firstStarted:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for first initializer transaction")
	}
}

func (barrier *transactionBeginBarrier) releaseSecondInitializer() {
	barrier.releaseOnce.Do(func() { close(barrier.releaseSecond) })
}

func (barrier *transactionBeginBarrier) beginCount() int {
	barrier.mu.Lock()
	defer barrier.mu.Unlock()
	return barrier.calls
}
