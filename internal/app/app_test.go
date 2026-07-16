package app

import (
	"bytes"
	"database/sql"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
)

func TestNew(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	err := os.MkdirAll(dataDir, 0o700)
	require.NoError(t, err)

	appInstance, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)
	t.Cleanup(func() { _ = appInstance.DB.Close() })

	assert.NotNil(t, appInstance.DB)
	assert.NotNil(t, appInstance.Crypto)
	assert.NotNil(t, appInstance.Session)
	assert.NotNil(t, appInstance.Terminal)
	assert.NotNil(t, appInstance.File)
	assert.NotNil(t, appInstance.Tunnel)
	assert.NotNil(t, appInstance.Key)
	assert.NotNil(t, appInstance.Macro)
	assert.NotNil(t, appInstance.Theme)
	assert.NotNil(t, appInstance.Log)
	assert.NotNil(t, appInstance.Sync)
	assert.NotNil(t, appInstance.Setting)
	assert.NotNil(t, appInstance.Font)

	assert.Len(t, appInstance.Crypto, 32)
	assert.NotNil(t, appInstance.Keychain)
}

func TestHandleTerminalRecordingCloseLogsStopError(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&output, &slog.HandlerOptions{Level: slog.LevelError}))
	stopErr := errors.New("stop failed")
	stopper := &stubRecordingStopper{err: stopErr}

	handleTerminalRecordingClose(stopper, logger, "term-close-error")

	assert.Equal(t, "term-close-error", stopper.terminalID)
	assert.Contains(t, output.String(), "stop terminal recording on close failed")
	assert.Contains(t, output.String(), "term-close-error")
	assert.Contains(t, output.String(), "stop failed")
}

func TestNewEmptyDataDir(t *testing.T) {
	_, err := New(Options{DataDir: ""})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "data directory is required")
}

type stubRecordingStopper struct {
	terminalID string
	err        error
}

func (stopper *stubRecordingStopper) StopTerminalRecordingIfActive(terminalID string) error {
	stopper.terminalID = terminalID
	return stopper.err
}

func TestCryptoAdapterEncrypt(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	ca := &cryptoAdapter{key: key}

	ciphertext, err := ca.Encrypt([]byte("hello"))
	require.NoError(t, err)
	assert.NotEqual(t, "hello", string(ciphertext))

	plaintext, err := ca.Decrypt(ciphertext)
	require.NoError(t, err)
	assert.Equal(t, "hello", string(plaintext))
}

func TestCryptoAdapterEncryptEmpty(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	ca := &cryptoAdapter{key: key}

	ciphertext, err := ca.Encrypt([]byte{})
	require.NoError(t, err)
	assert.NotNil(t, ciphertext)

	plaintext, err := ca.Decrypt(ciphertext)
	require.NoError(t, err)
	assert.Empty(t, plaintext)
}

func TestCryptoAdapterDecryptCorrupted(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	ca := &cryptoAdapter{key: key}

	_, err := ca.Decrypt([]byte("corrupted-data"))
	assert.Error(t, err)
}

func TestNewDataDirIsFile(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "file.txt")
	require.NoError(t, os.WriteFile(dataDir, []byte("data"), 0o600))

	_, err := New(Options{DataDir: dataDir})
	assert.Error(t, err)
}

func TestNewDataDirContainsNullByte(t *testing.T) {
	_, err := New(Options{DataDir: "/tmp/\x00invalid"})
	assert.Error(t, err)
}

func TestMasterKeyPersistence(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	err := os.MkdirAll(dataDir, 0o700)
	require.NoError(t, err)

	app1, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)
	t.Cleanup(func() { _ = app1.DB.Close() })
	key1 := string(app1.Crypto)

	app2, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)
	t.Cleanup(func() { _ = app2.DB.Close() })

	assert.Equal(t, key1, string(app2.Crypto), "master key should persist between sessions")
}

func TestApp_Shutdown(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	err := os.MkdirAll(dataDir, 0o700)
	require.NoError(t, err)

	appInstance, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)

	appInstance.Shutdown()
	appInstance.Shutdown()

	pingErr := appInstance.DB.Ping()
	assert.Error(t, pingErr, "db should be closed after shutdown")
}

func TestApp_ShutdownEndsActiveRecordingsBeforeClosingDatabase(t *testing.T) {
	dataDir := t.TempDir()
	appInstance, err := New(Options{DataDir: dataDir, Logger: DefaultTestLogger(t)})
	require.NoError(t, err)
	session, err := appInstance.Session.CreateSession(model.SessionInput{
		Name: "shutdown-recording", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	logID, err := appInstance.Log.StartTerminalRecording("term-shutdown", session.ID, 80, 24, "xterm")
	require.NoError(t, err)
	logs, err := appInstance.Log.List(nil)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	recordingPath := logs[0].DataPath

	appInstance.Shutdown()

	reopened, err := store.OpenDB(dataDir)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, reopened.Close()) })
	require.NoError(t, store.InitializeSchema(reopened))
	logEntry, err := store.GetSessionLog(reopened, logID)
	require.NoError(t, err)
	assert.NotNil(t, logEntry.EndedAt)
	require.NoError(t, os.Remove(recordingPath))
}

func TestApp_ShutdownLogsRecordingCloseErrors(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&output, &slog.HandlerOptions{Level: slog.LevelError}))
	appInstance, err := New(Options{DataDir: t.TempDir(), Logger: logger})
	require.NoError(t, err)
	session, err := appInstance.Session.CreateSession(model.SessionInput{
		Name: "shutdown-error", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	_, err = appInstance.Log.StartTerminalRecording("term-shutdown-error", session.ID, 80, 24, "xterm")
	require.NoError(t, err)
	require.NoError(t, appInstance.DB.Close())

	appInstance.Shutdown()

	assert.Contains(t, output.String(), "close active recordings during shutdown failed")
	assert.Contains(t, output.String(), "end session log")
}

func TestApp_ShutdownWaitsForConcurrentStopFinalizer(t *testing.T) {
	dataDir := t.TempDir()
	db, err := store.OpenDB(dataDir)
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	finalizerStarted := make(chan struct{})
	releaseFinalizer := make(chan struct{})
	logService := service.NewLogService(
		db,
		dataDir,
		slog.Default(),
		service.WithSessionLogFinalizer(func(db *sql.DB, logID int64) error {
			close(finalizerStarted)
			<-releaseFinalizer
			return store.EndSessionLog(db, logID)
		}),
	)
	session, err := store.CreateSession(db, model.Session{
		Name: "shutdown-finalizer", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	logID, err := logService.StartTerminalRecording("term-app-finalizer", session.ID, 80, 24, "xterm")
	require.NoError(t, err)
	appInstance := &App{DB: db, Log: logService, logger: slog.Default()}
	stopDone := make(chan error, 1)
	go func() { stopDone <- logService.StopTerminalRecording("term-app-finalizer") }()
	<-finalizerStarted
	shutdownDone := make(chan struct{})
	go func() {
		appInstance.Shutdown()
		close(shutdownDone)
	}()

	select {
	case <-shutdownDone:
		t.Fatal("app shutdown returned before stop finalizer completed")
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseFinalizer)
	require.NoError(t, <-stopDone)
	<-shutdownDone
	reopened, err := store.OpenDB(dataDir)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, reopened.Close()) })
	require.NoError(t, store.InitializeSchema(reopened))
	logEntry, err := store.GetSessionLog(reopened, logID)
	require.NoError(t, err)
	assert.NotNil(t, logEntry.EndedAt)
}
