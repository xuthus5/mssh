package app

import (
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestDefaultTestLogger(t *testing.T) {
	logger := DefaultTestLogger(t)
	assert.NotNil(t, logger)
	logger.Info("test log message")
}

func TestShutdownNilDB(t *testing.T) {
	a := &App{}
	a.Shutdown()
}

func TestNewWithLogger(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), ".mssh")
	appInstance, err := New(Options{DataDir: dataDir, Logger: slog.Default()})
	require.NoError(t, err)
	t.Cleanup(func() { _ = appInstance.DB.Close() })
	assert.NotNil(t, appInstance.Session)
}

func TestInitializeServicesReportsThemeInitializationFailure(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, db.Close())
	_, err = initializeServices(serviceInitialization{
		db: db, keychain: &stubKeychain{},
		opts: Options{DataDir: t.TempDir()}, eventBus: event.NewWailsEventBus(slog.Default()), logger: slog.Default(),
	})
	assert.ErrorContains(t, err, "initialize terminal themes")
}

type stubKeychain struct{}

func (s *stubKeychain) Get(_, _ string) ([]byte, error) { return nil, nil }

func (s *stubKeychain) Set(_, _ string, _ []byte) error { return nil }

func (s *stubKeychain) Delete(_, _ string) error { return nil }

func (s *stubKeychain) IsAvailable() bool { return false }
