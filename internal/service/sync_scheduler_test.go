package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSyncSchedulerStartsAndStopsForEnabledInterval(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSyncService(db, testutil.NewTestLogger())
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
	service := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger())
	service.StartScheduler()
	service.schedulerMu.Lock()
	assert.Nil(t, service.schedulerCancel)
	service.schedulerMu.Unlock()
	service.StopScheduler()
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
