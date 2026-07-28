package service

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSyncService_DestructiveOperationsRejectConcurrentSync(t *testing.T) {
	provider := &fakeSyncProvider{}
	service := NewSyncService(
		testutil.NewTestDB(t),
		testutil.NewTestLogger(),
		WithSyncDataDir(t.TempDir()),
		WithSyncProviderFactory(fakeSyncProviderFactory{provider}),
	)
	service.operationMu.Lock()
	t.Cleanup(service.operationMu.Unlock)

	tests := []struct {
		name string
		call func() error
	}{
		{name: "export", call: func() error { return service.Export(filepath.Join(t.TempDir(), "backup.msshbackup")) }},
		{name: "import", call: func() error { return service.Import(filepath.Join(t.TempDir(), "backup.msshbackup")) }},
		{name: "restore version", call: func() error { return service.RestoreVersion(1) }},
		{name: "reset local data", call: service.ResetLocalData},
		{name: "delete version", call: func() error { return service.DeleteVersion(1) }},
		{name: "cloud upload", call: func() error { return service.SyncToCloud("https://sync.example.test/backup", "", "") }},
		{name: "cloud download", call: func() error { return service.SyncFromCloud("https://sync.example.test/backup", "", "") }},
		{name: "legacy connection test", call: func() error { return service.TestCloudConnection("https://sync.example.test/backup", "", "") }},
		{name: "test provider", call: func() error { return service.TestProvider(syncTestConfigInput()) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.ErrorContains(t, test.call(), "sync operation is already running")
		})
	}
	assert.False(t, provider.tested)
}

func TestSyncService_SaveConfigWaitsForConcurrentSyncOperation(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	service.operationMu.Lock()
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		_, err := service.SaveConfig(syncTestConfigInput())
		done <- err
	}()
	<-started
	select {
	case err := <-done:
		t.Fatalf("config save completed before sync operation released: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	service.operationMu.Unlock()
	require.NoError(t, <-done)
	config, err := service.LoadConfig()
	require.NoError(t, err)
	assert.Equal(t, model.SyncProviderWebDAV, config.Provider)
}

func TestSyncService_ReadLocalBackupRejectsOversizedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "oversized.msshbackup")
	require.NoError(t, writePrivateFileAtomic(path, make([]byte, maxCloudBackupSize+1)))

	service := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger(),
		WithSyncDataDir(t.TempDir()),
		WithSyncSecretSource(func() (string, error) { return syncTestMasterKey, nil }),
	)
	err := service.Import(path)
	assert.ErrorContains(t, err, "exceeds")
}

func TestSyncService_SaveVersionRejectsOversizedContent(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey, WithSyncDataDir(t.TempDir()))
	metadata := syncArtifactMetadata{SnapshotFingerprint: "oversized", CreatedAt: time.Now().UTC()}

	_, err := service.saveVersion(make([]byte, maxCloudBackupSize+1), metadata, model.SyncProviderGist, "test", false)

	assert.ErrorContains(t, err, "exceeds")
}
