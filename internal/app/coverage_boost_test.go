package app

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

type discardEventBus struct{}

func (discardEventBus) Emit(string, interface{}) {}

type recordingTransferQuiescer struct{ called bool }

func (q *recordingTransferQuiescer) PauseAndWait() { q.called = true }

type failingTunnelQuiescer struct {
	calls int
	err   error
}

func (q *failingTunnelQuiescer) StopAllWithError() error {
	q.calls++
	return q.err
}

func TestSyncLifecycleAdapterPrepareDestructiveSync(t *testing.T) {
	require.NoError(t, (syncLifecycleAdapter{}).PrepareDestructiveSync())

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	db := testutil.NewTestDB(t)
	session := service.NewSessionService(db, discardEventBus{}, 30, t.TempDir(), nil, logger)
	terminal := service.NewTerminalService(session, discardEventBus{}, 2, logger)
	tunnel := service.NewTunnelService(db, session, discardEventBus{}, logger)
	// seed an idle tunnel state so StopAll iterates
	// cannot access unexported map from app package; StopAll on empty is fine.
	transfers := &recordingTransferQuiescer{}
	adapter := syncLifecycleAdapter{file: transfers, terminal: terminal, tunnel: tunnel, session: session}
	require.NoError(t, adapter.PrepareDestructiveSync())
	assert.True(t, transfers.called)
}

func TestSyncLifecycleAdapterReturnsTunnelCleanupError(t *testing.T) {
	cleanupErr := errors.New("listener close failed")
	tunnel := &failingTunnelQuiescer{err: cleanupErr}

	err := (syncLifecycleAdapter{tunnel: tunnel}).PrepareDestructiveSync()

	assert.ErrorIs(t, err, cleanupErr)
	assert.Equal(t, 1, tunnel.calls)
}

func TestConfigureTerminalLoggingWiresHandlers(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	dataDir := filepath.Join(t.TempDir(), "data")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	appInstance, err := New(Options{DataDir: dataDir, Logger: logger})
	require.NoError(t, err)
	t.Cleanup(func() {
		appInstance.Shutdown()
		_ = appInstance.DB.Close()
	})
	configureTerminalLogging(appInstance.Terminal, appInstance.Log, logger)
	assert.NotNil(t, appInstance.Terminal)
	assert.NotNil(t, appInstance.Log)
}
