package service

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"modernc.org/sqlite"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

var rotationCommitDriverID atomic.Uint64

func TestRotateKeepsCommittedStateWhenDriverReportsCommitError(t *testing.T) {
	database, controller, dataDir := newRotationCommitErrorDB(t)
	runtime := NewCryptoRuntime()
	security := NewSecurityService(database, dataDir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := security.Setup(model.SecuritySetupInput{Password: "old-password-12", RememberUnlock: false})
	require.NoError(t, err)
	sessions := NewSessionService(database, newMockEventBus(), 30, dataDir, runtime, testutil.NewTestLogger())
	created, err := sessions.CreateSession(model.SessionInputFrom(model.Session{
		Name: "commit-uncertain", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "session-secret", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	controller.failAfterCommits(2)

	_, err = security.Rotate(model.SecurityRotateInput{
		CurrentPassword: "old-password-12",
		NewPassword:     "new-password-12",
	})

	require.NoError(t, err)
	assertVaultPassword(t, dataDir, "old-password-12", false)
	assertVaultPassword(t, dataDir, "new-password-12", true)
	entry, err := store.GetSettingEntry(database, securityRotationPendingSetting)
	require.NoError(t, err)
	assert.Nil(t, entry)
	connected, err := sessions.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "session-secret", connected.Password)
}

func assertVaultPassword(t *testing.T, dataDir, password string, valid bool) {
	t.Helper()
	vault, err := crypto.LoadVaultFile(crypto.VaultPath(dataDir))
	require.NoError(t, err)
	dek, unlockErr := crypto.UnlockVault(password, vault)
	clear(dek)
	if valid {
		assert.NoError(t, unlockErr)
		return
	}
	assert.Error(t, unlockErr)
}

type rotationCommitErrorController struct {
	commitCount atomic.Int64
	failCommit  atomic.Int64
}

func (controller *rotationCommitErrorController) failAfterCommits(offset int64) {
	controller.failCommit.Store(controller.commitCount.Load() + offset)
}

type rotationCommitErrorDriver struct {
	driver.Driver
	controller *rotationCommitErrorController
}

func (wrapped *rotationCommitErrorDriver) Open(name string) (driver.Conn, error) {
	connection, err := wrapped.Driver.Open(name)
	if err != nil {
		return nil, err
	}
	return &rotationCommitErrorConn{Conn: connection, controller: wrapped.controller}, nil
}

type rotationCommitErrorConn struct {
	driver.Conn
	controller *rotationCommitErrorController
}

func (connection *rotationCommitErrorConn) BeginTx(ctx context.Context, options driver.TxOptions) (driver.Tx, error) {
	beginner, ok := connection.Conn.(driver.ConnBeginTx)
	if !ok {
		return nil, errors.New("sqlite connection does not support BeginTx")
	}
	transaction, err := beginner.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return &rotationCommitErrorTx{Tx: transaction, controller: connection.controller}, nil
}

type rotationCommitErrorTx struct {
	driver.Tx
	controller *rotationCommitErrorController
}

func (transaction *rotationCommitErrorTx) Commit() error {
	if err := transaction.Tx.Commit(); err != nil {
		return err
	}
	commit := transaction.controller.commitCount.Add(1)
	if commit == transaction.controller.failCommit.Load() {
		return errors.New("commit completed but response was lost")
	}
	return nil
}

func newRotationCommitErrorDB(t *testing.T) (*sql.DB, *rotationCommitErrorController, string) {
	t.Helper()
	dataDir := t.TempDir()
	databasePath := filepath.Join(dataDir, "mssh.db")
	file, err := os.OpenFile(databasePath, os.O_RDWR|os.O_CREATE, 0o600)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	controller := &rotationCommitErrorController{}
	driverName := fmt.Sprintf("sqlite_rotation_commit_error_%d", rotationCommitDriverID.Add(1))
	sql.Register(driverName, &rotationCommitErrorDriver{Driver: &sqlite.Driver{}, controller: controller})
	dsn := databasePath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate"
	database, err := sql.Open(driverName, dsn)
	require.NoError(t, err)
	database.SetMaxOpenConns(1)
	require.NoError(t, database.Ping())
	require.NoError(t, store.InitializeSchema(database))
	t.Cleanup(func() { require.NoError(t, database.Close()) })
	return database, controller, dataDir
}
