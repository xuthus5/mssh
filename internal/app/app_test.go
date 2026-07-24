package app

import (
	"bytes"
	"database/sql"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
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
	assert.NotNil(t, appInstance.Security)
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

	assert.False(t, appInstance.Security == nil)
	assert.NotNil(t, appInstance.Keychain)
}

func TestNewRecoversInterruptedTransfersOnlyAtStartup(t *testing.T) {
	dataDir := t.TempDir()
	db, err := store.OpenDB(dataDir)
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	require.NoError(t, store.CreateTransferJob(db, model.TransferJob{
		ID: "interrupted", SessionID: 1, SessionName: "server", Direction: "download",
		SourcePath: "/remote", TargetPath: "/local", Status: "running", StartedAt: time.Now(),
	}))
	require.NoError(t, db.Close())

	appInstance, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)
	t.Cleanup(appInstance.Shutdown)

	jobs, err := appInstance.File.ListTransfers()
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "failed", jobs[0].Status)
	assert.Contains(t, jobs[0].Error, "中断")

	require.NoError(t, store.CreateTransferJob(appInstance.DB, model.TransferJob{
		ID: "active", SessionID: 1, SessionName: "server", Direction: "upload",
		SourcePath: "/local", TargetPath: "/remote", Status: "queued", StartedAt: time.Now(),
	}))
	jobs, err = appInstance.File.ListTransfers()
	require.NoError(t, err)
	var active model.TransferJob
	for _, job := range jobs {
		if job.ID == "active" {
			active = job
			break
		}
	}
	assert.Equal(t, "queued", active.Status)
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

func TestNewWiresSecurityService(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	appInstance, err := New(Options{DataDir: dataDir})
	require.NoError(t, err)
	t.Cleanup(func() { appInstance.Shutdown() })
	require.NotNil(t, appInstance.Security)
	status, err := appInstance.Security.Status()
	require.NoError(t, err)
	assert.False(t, status.Configured)
	assert.False(t, status.Unlocked)
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

func TestAppShutdownStopsSyncBeforeTerminal(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))

	secretStarted := make(chan struct{})
	releaseSecret := make(chan struct{})
	var blockSecret atomic.Bool
	var secretOnce sync.Once
	release := func() { close(releaseSecret) }
	t.Cleanup(func() {
		if blockSecret.Load() {
			select {
			case <-releaseSecret:
			default:
				close(releaseSecret)
			}
		}
	})
	t.Cleanup(func() { _ = db.Close() })

	syncService := service.NewSyncService(db, slog.Default(),
		service.WithSyncDataDir(t.TempDir()),
		service.WithSyncSecretSource(func() (string, error) {
			if blockSecret.Load() {
				secretOnce.Do(func() { close(secretStarted) })
				<-releaseSecret
			}
			return "sync-test-key", nil
		}),
	)
	_, err = syncService.SaveConfig(model.SyncConfigInput{
		Enabled: true, Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart,
		IntervalMinutes: 0, RetentionCount: 1, RetentionDays: 1,
	})
	require.NoError(t, err)
	terminalService := service.NewTerminalService(nil, discardEventBus{}, 4, slog.Default())
	if runtime.GOOS == "windows" {
		t.Skip("local shell lifecycle is covered by the Windows conpty integration suite")
	}
	_, err = terminalService.OpenLocal(t.Context(), 80, 24)
	require.NoError(t, err)
	blockSecret.Store(true)
	syncService.NotifyVaultUnlocked()
	select {
	case <-secretStarted:
	case <-time.After(time.Second):
		t.Fatal("scheduled sync did not reach secret source")
	}

	appInstance := &App{DB: db, Sync: syncService, Terminal: terminalService, logger: slog.Default()}
	shutdownDone := make(chan struct{})
	go func() {
		appInstance.Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("shutdown completed while sync request was blocked")
	case <-time.After(50 * time.Millisecond):
		assert.Equal(t, 1, terminalService.Count())
	}

	release()
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not complete after sync request was released")
	}
}

func TestApp_ShutdownClosesLocalTerminals(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("local shell lifecycle is covered by the Windows conpty integration suite")
	}
	terminal := service.NewTerminalService(nil, discardEventBus{}, 4, slog.Default())
	terminalID, err := terminal.OpenLocal(t.Context(), 80, 24)
	require.NoError(t, err)

	appInstance := &App{Terminal: terminal, logger: slog.Default()}
	appInstance.Shutdown()

	_, err = terminal.Write(terminalID, "echo after shutdown\n")
	assert.Error(t, err)
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
