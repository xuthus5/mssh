package app

import (
	"bytes"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type appSessionFolderListResult struct {
	folders []model.SessionFolder
	err     error
}

type appBlockingSessionCrypto struct {
	runtime     *service.CryptoRuntime
	started     chan struct{}
	release     chan struct{}
	startedOnce sync.Once
	releaseOnce sync.Once
}

type appSessionCreateResult struct {
	session *model.Session
	err     error
}

func (crypto *appBlockingSessionCrypto) Encrypt(plaintext []byte) ([]byte, error) {
	crypto.startedOnce.Do(func() { close(crypto.started) })
	<-crypto.release
	return crypto.runtime.Encrypt(plaintext)
}

func (crypto *appBlockingSessionCrypto) Decrypt(ciphertext []byte) ([]byte, error) {
	return crypto.runtime.Decrypt(ciphertext)
}

func (crypto *appBlockingSessionCrypto) releaseEncryption() {
	crypto.releaseOnce.Do(func() { close(crypto.release) })
}

func TestAppShutdownWaitsForSessionOperationsBeforeClosingDatabase(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	sessionService := service.NewSessionService(database, nil, 30, t.TempDir(), nil, DefaultTestLogger(t))
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	listDone := make(chan appSessionFolderListResult, 1)
	go func() {
		folders, listErr := sessionService.ListFolders()
		listDone <- appSessionFolderListResult{folders: folders, err: listErr}
	}()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, Session: sessionService, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()
	assertShutdownPending(t, shutdownDone, "active session database operation")
	rollback()
	result := <-listDone
	require.NoError(t, result.err)
	assert.NotNil(t, result.folders)
	assertShutdownCompleted(t, shutdownDone, "session database operation")
	assert.Error(t, database.Ping())
	_, err = sessionService.ListFolders()
	require.ErrorContains(t, err, "session service is shutting down")
}

func TestAppShutdownWaitsForSessionCryptoBeforeClearingVault(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	runtime := service.NewCryptoRuntime()
	runtime.SetDEK(bytes.Repeat([]byte{6}, 32))
	crypto := &appBlockingSessionCrypto{
		runtime: runtime, started: make(chan struct{}), release: make(chan struct{}),
	}
	t.Cleanup(crypto.releaseEncryption)
	sessionService := service.NewSessionService(database, nil, 30, t.TempDir(), crypto, DefaultTestLogger(t))
	securityService := service.NewSecurityService(database, t.TempDir(), runtime, nil, DefaultTestLogger(t))
	createDone := make(chan appSessionCreateResult, 1)
	go func() {
		created, createErr := sessionService.CreateSession(model.SessionInputFrom(model.Session{
			Name: "shutdown", Host: "127.0.0.1", Port: 22, Username: "root",
			AuthMethod: model.AuthPassword, Password: "session-secret", KeepAlive: 30, TermType: "xterm-256color",
		}))
		createDone <- appSessionCreateResult{session: created, err: createErr}
	}()
	<-crypto.started

	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, Session: sessionService, Security: securityService, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()
	assertShutdownPending(t, shutdownDone, "active session crypto operation")
	require.NoError(t, runtime.RequireUnlocked())
	crypto.releaseEncryption()
	result := <-createDone
	require.NoError(t, result.err)
	assert.Equal(t, "shutdown", result.session.Name)
	assertShutdownCompleted(t, shutdownDone, "session crypto operation")
	assert.Error(t, database.Ping())
	assert.ErrorIs(t, runtime.RequireUnlocked(), service.ErrVaultLocked)
}
