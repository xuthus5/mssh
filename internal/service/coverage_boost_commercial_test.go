package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestCryptoRuntimeSetDEKNilAndRequire(t *testing.T) {
	runtime := NewCryptoRuntime()
	assert.ErrorIs(t, runtime.RequireUnlocked(), ErrVaultLocked)
	runtime.SetDEK(nil)
	assert.False(t, runtime.Unlocked())
	dek := make([]byte, 32)
	runtime.SetDEK(dek)
	require.NoError(t, runtime.RequireUnlocked())
	runtime.Clear()
	assert.ErrorIs(t, runtime.RequireUnlocked(), ErrVaultLocked)
}

func TestHostKeyDeletePositiveLine(t *testing.T) {
	dir := t.TempDir()
	svc := NewSessionService(nil, newMockEventBus(), 30, dir, nil, testutil.NewTestLogger())
	assert.Error(t, svc.DeleteHostKey(0))
	path := filepath.Join(dir, "known_hosts")
	require.NoError(t, os.WriteFile(path, []byte("# comment\n"), 0o600))
	assert.Error(t, svc.DeleteHostKey(5))
}

func TestSessionCSVPasswordSealBranches(t *testing.T) {
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 9)
	}
	runtime.SetDEK(dek)
	svc := &SessionService{crypto: runtime}
	input := model.SessionInputFrom(model.Session{Password: ""})
	require.NoError(t, svc.sealSessionPasswordForCSV(&input, false))
	assert.Equal(t, "", input.Password)

	input = model.SessionInputFrom(model.Session{Password: sessionPasswordPrefix + "keep"})
	require.NoError(t, svc.sealSessionPasswordForCSV(&input, false))
	assert.Equal(t, sessionPasswordPrefix+"keep", input.Password)

	input = model.SessionInputFrom(model.Session{Password: "plain"})
	require.NoError(t, svc.sealSessionPasswordForCSV(&input, true))
	assert.Equal(t, "plain", input.Password)

	input = model.SessionInputFrom(model.Session{Password: "plain"})
	require.NoError(t, svc.sealSessionPasswordForCSV(&input, false))
	assert.NotEqual(t, "plain", input.Password)
	assert.True(t, len(input.Password) > 0)

	// nil crypto keeps plaintext (legacy/test path)
	svc = &SessionService{}
	input = model.SessionInputFrom(model.Session{Password: "plain"})
	require.NoError(t, svc.sealSessionPasswordForCSV(&input, false))
	assert.Equal(t, "plain", input.Password)
}

func TestWritePrivateFileAtomicErrors(t *testing.T) {
	dir := t.TempDir()
	assert.Error(t, writePrivateFileAtomic(dir, []byte("x")))
}

func TestSyncHistoryRecordAndEnsureDir(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(dir))
	svc.recordSyncEvent("test", model.SyncConfig{Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart}, model.SyncEventSuccess, 1, 2, "hello")
	events, err := store.ListSyncEvents(db, 10)
	require.NoError(t, err)
	require.NotEmpty(t, events)
	require.NoError(t, svc.ensureVersionDirectory())
	info, err := os.Stat(filepath.Join(dir, "sync", "versions"))
	require.NoError(t, err)
	assert.True(t, info.IsDir())
	// empty data dir branch
	empty := NewSyncService(db, testutil.NewTestLogger())
	assert.Error(t, empty.ensureVersionDirectory())
}

func TestAssetCatalogUpdateTagRoundTrip(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewAssetCatalogService(db, testutil.NewTestLogger())
	tag, err := svc.CreateTag(model.AssetTagInput{Name: "prod", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	require.NoError(t, svc.UpdateTag(model.AssetTagInput{ID: tag.ID, Name: "production", ColorToken: model.AssetColorBlue}))
}

func TestAIDeleteProviderMissing(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewAIService(db, nil, &memoryKeychain{}, testutil.NewTestLogger())
	// missing provider delete is idempotent
	assert.NoError(t, svc.DeleteProvider(9999))
}

func TestTerminalDetachMissing(t *testing.T) {
	svc := NewTerminalService(nil, newMockEventBus(), 2, testutil.NewTestLogger())
	assert.Equal(t, 0, svc.Count())
	pty, connID, handler, ok := svc.detachTerminal("missing")
	assert.False(t, ok)
	assert.Nil(t, pty)
	assert.Equal(t, "", connID)
	assert.Nil(t, handler)
}

func TestSettingApplyLogSettingsNoop(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSettingService(db, testutil.NewTestLogger())
	require.NoError(t, svc.applyLogSettings(nil))
	require.NoError(t, svc.applyLogSettings([]model.Setting{{Key: "other", Value: "1"}}))
}

func TestFinishJoinSuccessRecords(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()))
	result := svc.finishJoinSuccess(model.SyncConfig{Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart})
	assert.Equal(t, model.SyncStateSynced, result.State)
}

func TestOpenAgentAuthNoSocket(t *testing.T) {
	t.Setenv("SSH_AUTH_SOCK", "")
	_, err := openAgentAuth()
	assert.Error(t, err)
}

func TestSessionDisconnectMissing(t *testing.T) {
	svc := NewSessionService(testutil.NewTestDB(t), newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	assert.Error(t, svc.disconnect("missing", true))
}

func TestEventBusHostKeyAutoAcceptInterface(t *testing.T) {
	bus := newMockEventBus()
	assert.True(t, bus.AutoAcceptHostKeys())
	manual := newManualHostKeyEventBus()
	assert.False(t, manual.AutoAcceptHostKeys())
	bus.Emit(event.HostKeyFingerprint, event.HostKeyPayload{AttemptID: "a", Hostname: "h"})
	assert.True(t, bus.hasEvent(event.HostKeyFingerprint))
	_ = time.Now()
}
