package app

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/applog"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

func TestNewAppliesStoredApplicationLogDirectory(t *testing.T) {
	dataDir := t.TempDir()
	initialLogDir := t.TempDir()
	storedLogDir := t.TempDir()
	seedStoredLogSettings(t, dataDir, storedLogDir)

	manager := applog.New(applog.Options{Dir: initialLogDir, RetentionDays: 30})
	require.NoError(t, manager.Configure(initialLogDir, 30))
	logger := slog.New(manager.Handler())
	appInstance, err := New(Options{DataDir: dataDir, Logger: logger, LogManager: manager})
	require.NoError(t, err)
	t.Cleanup(func() {
		appInstance.Shutdown()
		_ = manager.Close()
	})

	assert.Equal(t, storedLogDir, manager.Dir())
	assert.Equal(t, 14, manager.RetentionDays())
	logger.Info("stored-log-destination-marker")
	fileName := time.Now().Local().Format("2006-01-02") + ".log"
	storedContent, err := os.ReadFile(filepath.Join(storedLogDir, fileName))
	require.NoError(t, err)
	assert.Contains(t, string(storedContent), "stored-log-destination-marker")
	initialContent, err := os.ReadFile(filepath.Join(initialLogDir, fileName))
	require.NoError(t, err)
	assert.NotContains(t, string(initialContent), "stored-log-destination-marker")
}

func seedStoredLogSettings(t *testing.T, dataDir, logDir string) {
	t.Helper()
	db, err := store.OpenDB(dataDir)
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	encodedDir, err := json.Marshal(logDir)
	require.NoError(t, err)
	require.NoError(t, store.SetSettings(db, []model.Setting{
		{Key: "application.log_dir", Namespace: "application", Value: string(encodedDir), ValueType: "string", Version: 1},
		{Key: "application.log_retention_days", Namespace: "application", Value: "14", ValueType: "number", Version: 1},
	}))
	require.NoError(t, db.Close())
}
