package app

import (
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/service/testutil"
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

func TestInitializeServicesUsesPersistedTerminalPoolSize(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want int
	}{
		{name: "configured", raw: "7", want: 7},
		{name: "invalid falls back", raw: "0", want: service.DefaultTerminalPoolSize},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			require.NoError(t, store.SetSettings(db, []model.Setting{{
				Key: "terminal.max_pool_size", Namespace: "terminal", Value: test.raw, ValueType: "number", Version: 1,
			}}))
			appInstance, err := initializeServices(serviceInitialization{
				db: db, keychain: &stubKeychain{}, opts: Options{DataDir: t.TempDir()},
				eventBus: event.NewWailsEventBus(slog.Default()), logger: slog.Default(),
			})
			require.NoError(t, err)
			t.Cleanup(func() { appInstance.Shutdown() })
			assert.Equal(t, test.want, appInstance.Terminal.MaxSize())
		})
	}
}

type stubKeychain struct{}

func (s *stubKeychain) Get(_, _ string) ([]byte, error) { return nil, nil }

func (s *stubKeychain) Set(_, _ string, _ []byte) error { return nil }

func (s *stubKeychain) Delete(_, _ string) error { return nil }

func (s *stubKeychain) IsAvailable() bool { return false }
