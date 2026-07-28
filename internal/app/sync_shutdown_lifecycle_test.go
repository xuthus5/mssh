package app

import (
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAppShutdownWaitsForManualSyncOperation(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))

	secretStarted := make(chan struct{})
	releaseSecret := make(chan struct{})
	var blockSecret atomic.Bool
	var secretOnce sync.Once
	syncService := service.NewSyncService(database, slog.Default(), service.WithSyncSecretSource(func() (string, error) {
		if blockSecret.Load() {
			secretOnce.Do(func() { close(secretStarted) })
			<-releaseSecret
		}
		return "sync-test-key", nil
	}))
	_, err = syncService.SaveConfig(model.SyncConfigInput{
		Enabled: true, Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart,
		IntervalMinutes: 0, RetentionCount: 1, RetentionDays: 1,
	})
	require.NoError(t, err)

	blockSecret.Store(true)
	syncDone := make(chan struct{})
	go func() {
		_, _ = syncService.SyncNow()
		close(syncDone)
	}()
	<-secretStarted
	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, Sync: syncService, logger: slog.Default()}).Shutdown()
		close(shutdownDone)
	}()

	returnedEarly := false
	select {
	case <-shutdownDone:
		returnedEarly = true
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseSecret)
	<-syncDone
	<-shutdownDone
	assert.False(t, returnedEarly, "shutdown returned before the manual sync operation completed")
}

func TestAppShutdownWaitsForSyncDashboardBeforeClosingDatabase(t *testing.T) {
	database := testutil.NewTestDB(t)
	syncService := service.NewSyncService(database, slog.Default(),
		service.WithSyncSecretSource(func() (string, error) { return "sync-test-key", nil }))
	rollback := testutil.HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	dashboardDone := make(chan error, 1)
	go func() {
		_, err := syncService.Dashboard()
		dashboardDone <- err
	}()
	testutil.WaitForDatabaseWaitCount(t, database, baselineWaits+1)

	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, Sync: syncService, logger: slog.Default()}).Shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
		t.Fatal("app shutdown returned before the sync dashboard query completed")
	case <-time.After(50 * time.Millisecond):
	}

	rollback()
	require.NoError(t, <-dashboardDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("app shutdown did not finish after the sync dashboard query completed")
	}
	assert.Error(t, database.Ping())
}
