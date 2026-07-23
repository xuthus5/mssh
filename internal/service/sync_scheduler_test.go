package service

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSyncSchedulerStartsAndStopsForEnabledInterval(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey)
	config := defaultSyncConfig()
	config.Enabled = true
	config.IntervalMinutes = 5
	require.NoError(t, writeSyncSetting(db, syncConfigSetting, config))

	service.StartScheduler()
	service.schedulerMu.Lock()
	started := service.schedulerCancel != nil
	service.schedulerMu.Unlock()
	service.StopScheduler()

	assert.True(t, started)
	service.schedulerMu.Lock()
	assert.Nil(t, service.schedulerCancel)
	service.schedulerMu.Unlock()
}

func TestSyncSchedulerRemainsStoppedWhenDisabled(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	service.StartScheduler()
	service.schedulerMu.Lock()
	assert.Nil(t, service.schedulerCancel)
	service.schedulerMu.Unlock()
	service.StopScheduler()
}

func TestEnsureVaultReadyForSync(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	require.NoError(t, service.ensureVaultReadyForSync())

	locked := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger(),
		WithSyncSecretSource(func() (string, error) { return "", errors.New("locked") }),
	)
	require.Error(t, locked.ensureVaultReadyForSync())

	empty := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger(),
		WithSyncSecretSource(func() (string, error) { return "", nil }),
	)
	require.Error(t, empty.ensureVaultReadyForSync())

	missing := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger())
	require.Error(t, missing.ensureVaultReadyForSync())
}

func TestRunScheduledSyncSkipsWhenVaultLocked(t *testing.T) {
	var calls atomic.Int32
	service := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger(),
		WithSyncSecretSource(func() (string, error) {
			calls.Add(1)
			return "", errors.New("locked")
		}),
	)
	// Should return immediately without entering runSync (which would set error state).
	service.runScheduledSync(context.Background())
	assert.Equal(t, int32(1), calls.Load())
	dashboard, err := service.Dashboard()
	require.NoError(t, err)
	// State must not flip to error just because vault is locked on a scheduled tick.
	assert.NotEqual(t, model.SyncStateError, dashboard.State)
}

func TestRunScheduledSyncSkipsWhenDisabled(t *testing.T) {
	var secretCalls atomic.Int32
	db := testutil.NewTestDB(t)
	service := NewSyncService(db, testutil.NewTestLogger(),
		WithSyncSecretSource(func() (string, error) {
			secretCalls.Add(1)
			return "ready-secret", nil
		}),
	)
	// Default config is disabled.
	service.runScheduledSync(context.Background())
	assert.GreaterOrEqual(t, secretCalls.Load(), int32(1))
	dashboard, err := service.Dashboard()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateDisabled, dashboard.State)
}

func TestNotifyVaultUnlockedIsNilSafe(t *testing.T) {
	var service *SyncService
	assert.NotPanics(t, func() { service.NotifyVaultUnlocked() })

	// Non-nil service with locked vault should not panic either.
	locked := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger(),
		WithSyncSecretSource(func() (string, error) { return "", errors.New("locked") }),
	)
	locked.NotifyVaultUnlocked()
	// Give the goroutine a moment to exit.
	time.Sleep(20 * time.Millisecond)
}

func TestCloseAllTerminalsHandlesNilAndActiveEntries(t *testing.T) {
	assert.NoError(t, CloseAllTerminals(nil))
	eventBus := &fakeSyncEventBus{}
	service := NewTerminalService(nil, eventBus, 2, testutil.NewTestLogger())
	service.ptys["terminal-1"] = nil
	service.connIDs["terminal-1"] = ""

	require.NoError(t, CloseAllTerminals(service))
	assert.Equal(t, 0, service.Count())
	assert.Equal(t, "terminal:closed", eventBus.name)
}
