package service

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type fakeSyncProvider struct {
	remote syncRemoteObject
	tested bool
}

func (f *fakeSyncProvider) Test(context.Context) error { f.tested = true; return nil }

func (f *fakeSyncProvider) Fetch(context.Context) (syncRemoteObject, error) {
	if f.remote.Content == nil {
		return syncRemoteObject{}, errSyncRemoteNotFound
	}
	return f.remote, nil
}

func (f *fakeSyncProvider) Put(_ context.Context, content []byte, etag string) (syncRemoteObject, error) {
	if f.remote.Content != nil && etag != f.remote.ETag {
		return syncRemoteObject{}, errSyncConflict
	}
	f.remote = syncRemoteObject{Content: append([]byte(nil), content...), ETag: `"next"`, ProviderID: "provider-1"}
	return f.remote, nil
}

type fakeSyncProviderFactory struct{ provider *fakeSyncProvider }

func (f fakeSyncProviderFactory) Create(context.Context, model.SyncConfig, syncProviderSecrets) (syncProvider, error) {
	return f.provider, nil
}

type fakeSyncLifecycle struct{ calls int }

func (f *fakeSyncLifecycle) PrepareDestructiveSync() error { f.calls++; return nil }

func TestSyncEnginePushNoopConflictAndResolveCloud(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	_, err := store.CreateSession(db, model.Session{Name: "local", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	provider := &fakeSyncProvider{}
	lifecycle := &fakeSyncLifecycle{}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()), WithSyncProviderFactory(fakeSyncProviderFactory{provider}), WithSyncLifecycle(lifecycle))
	_, err = service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)

	result, err := service.SyncNow()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	versions, err := service.ListVersions()
	require.NoError(t, err)
	require.Len(t, versions, 1)

	result, err = service.SyncNow()
	require.NoError(t, err)
	assert.Contains(t, result.Message, "无变化")
	versions, err = service.ListVersions()
	require.NoError(t, err)
	assert.Len(t, versions, 1)

	_, err = store.CreateSession(db, model.Session{Name: "local-change", Host: "127.0.0.2", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	provider.remote = remoteArtifactForTest(t, "remote-change")
	result, err = service.SyncNow()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateConflict, result.State)
	require.NotNil(t, result.Conflict)

	result, err = service.ResolveConflict(model.SyncConflictUseCloud)
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	assert.Equal(t, 1, lifecycle.calls)
	sessions, err := store.ListSessions(db, nil)
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	assert.Equal(t, "remote-change", sessions[0].Name)
}

func TestSyncEngineRejectsConcurrentOperation(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	_, err := service.SyncNow()
	assert.ErrorContains(t, err, "already running")
}

func TestSyncEngineDownloadsRemoteOnlyChange(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	_, err := store.CreateSession(db, model.Session{Name: "local", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	provider := &fakeSyncProvider{}
	lifecycle := &fakeSyncLifecycle{}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()), WithSyncProviderFactory(fakeSyncProviderFactory{provider}), WithSyncLifecycle(lifecycle))
	_, err = service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)
	_, err = service.SyncNow()
	require.NoError(t, err)
	provider.remote = remoteArtifactForTest(t, "remote-only")

	result, err := service.SyncNow()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	assert.Equal(t, 1, lifecycle.calls)
	assert.Equal(t, []string{"remote-only"}, syncSessionNames(t, db))
}

func TestSyncEngineManualDirectionsAndLocalConflictResolution(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	_, err := store.CreateSession(db, model.Session{Name: "initial", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	provider := &fakeSyncProvider{}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()), WithSyncProviderFactory(fakeSyncProviderFactory{provider}))
	_, err = service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)
	_, err = service.PushNow()
	require.NoError(t, err)
	provider.remote = remoteArtifactForTest(t, "pulled")
	_, err = service.PullNow()
	require.NoError(t, err)
	assert.Equal(t, []string{"pulled"}, syncSessionNames(t, db))

	_, err = store.CreateSession(db, model.Session{Name: "local-change", Host: "127.0.0.2", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	provider.remote = remoteArtifactForTest(t, "remote-change")
	result, err := service.SyncNow()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateConflict, result.State)
	result, err = service.ResolveConflict(model.SyncConflictUseLocal)
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	artifact, err := decodeSyncArtifact(provider.remote.Content, syncTestMasterKey)
	require.NoError(t, err)
	restoredDB := testutil.NewTestDB(t)
	require.NoError(t, newTestSyncService(restoredDB, syncTestMasterKey).restore(artifact.Data))
	assert.ElementsMatch(t, []string{"pulled", "local-change"}, syncSessionNames(t, restoredDB))
}

func TestSyncServiceTestsProviderAndRecordsEvent(t *testing.T) {
	db := testutil.NewTestDB(t)
	provider := &fakeSyncProvider{}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncProviderFactory(fakeSyncProviderFactory{provider}))
	require.NoError(t, service.TestProvider(syncTestConfigInput()))
	assert.True(t, provider.tested)
	events, err := service.ListEvents()
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.SyncEventSuccess, events[0].Status)
}

func TestSyncConflictUsesLogicalLocalVersionNumber(t *testing.T) {
	db := testutil.NewTestDB(t)
	_, err := store.InsertSyncVersion(db, model.SyncVersion{
		VersionID: "local-version", VersionNumber: 7, SnapshotFingerprint: "local-fingerprint",
		Provider: model.SyncProviderWebDAV, Source: "test", FileName: "local.msshbackup", CreatedAt: time.Now().UTC(),
	})
	require.NoError(t, err)
	remote := remoteArtifactForTest(t, "remote")
	artifact, err := decodeSyncArtifact(remote.Content, syncTestMasterKey)
	require.NoError(t, err)
	service := newTestSyncService(db, syncTestMasterKey)
	result, err := service.createConflict(defaultSyncConfig(), syncCurrentSnapshot{Fingerprint: "local-fingerprint"}, artifact, remote.ETag)
	require.NoError(t, err)
	require.NotNil(t, result.Conflict)
	assert.Equal(t, int64(7), result.Conflict.Local.VersionNumber)
}

func remoteArtifactForTest(t *testing.T, sessionName string) syncRemoteObject {
	t.Helper()
	db := testutil.NewTestDB(t)
	_, err := store.CreateSession(db, model.Session{Name: sessionName, Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	metadata := syncArtifactMetadata{VersionID: "remote-version-" + sessionName, VersionNumber: 2, SnapshotFingerprint: fingerprint, CreatedAt: time.Now().UTC()}
	content, err := encodeSyncArtifact(data, syncTestMasterKey, metadata, nil)
	require.NoError(t, err)
	return syncRemoteObject{Content: content, ETag: `"remote"`}
}

func syncTestConfigInput() model.SyncConfigInput {
	return model.SyncConfigInput{
		Enabled: true, Provider: model.SyncProviderWebDAV, Strategy: model.SyncStrategySmart,
		IntervalMinutes: 0, RetentionCount: 30, RetentionDays: 90,
		WebDAV: model.WebDAVSyncConfigInput{URL: "https://dav.example/backups"},
	}
}

func syncSessionNames(t *testing.T, db *sql.DB) []string {
	t.Helper()
	sessions, err := store.ListSessions(db, nil)
	require.NoError(t, err)
	names := make([]string, 0, len(sessions))
	for _, session := range sessions {
		names = append(names, session.Name)
	}
	return names
}

var _ syncProviderFactory = fakeSyncProviderFactory{}

var _ syncLifecycle = (*fakeSyncLifecycle)(nil)
