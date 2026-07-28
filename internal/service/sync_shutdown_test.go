package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

type shutdownBlockingProvider struct {
	started chan struct{}
	once    sync.Once
}

func (provider *shutdownBlockingProvider) Test(context.Context) error { return nil }

func (provider *shutdownBlockingProvider) Fetch(ctx context.Context) (syncRemoteObject, error) {
	provider.once.Do(func() { close(provider.started) })
	<-ctx.Done()
	return syncRemoteObject{}, ctx.Err()
}

func (provider *shutdownBlockingProvider) Put(context.Context, []byte, string) (syncRemoteObject, error) {
	return syncRemoteObject{}, assert.AnError
}

type shutdownProviderFactory struct{ provider syncProvider }

func (factory shutdownProviderFactory) Create(context.Context, model.SyncConfig, syncProviderSecrets) (syncProvider, error) {
	return factory.provider, nil
}

func TestSyncServiceShutdownCancelsActiveSyncAndRejectsNewOperations(t *testing.T) {
	provider := &shutdownBlockingProvider{started: make(chan struct{})}
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey,
		WithSyncProviderFactory(shutdownProviderFactory{provider: provider}))
	_, err := service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)

	syncDone := make(chan error, 1)
	go func() {
		_, syncErr := service.SyncNow()
		syncDone <- syncErr
	}()
	<-provider.started
	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()

	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("sync shutdown did not cancel the active network operation")
	}
	assert.ErrorIs(t, <-syncDone, context.Canceled)
	_, err = service.SyncNow()
	assert.ErrorIs(t, err, errSyncServiceStopped)
	_, err = service.SaveConfig(syncTestConfigInput())
	assert.ErrorIs(t, err, errSyncServiceStopped)
	assert.ErrorIs(t, service.TestCloudConnection("https://dav.example/backups", "", ""), errSyncServiceStopped)
	service.Shutdown()
}

func TestSyncServiceShutdownRejectsQueuedConfigSave(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	service.operationMu.Lock()
	saveStarted := make(chan struct{})
	saveDone := make(chan error, 1)
	go func() {
		close(saveStarted)
		_, err := service.SaveConfig(syncTestConfigInput())
		saveDone <- err
	}()
	<-saveStarted
	shutdownDone := make(chan struct{})
	go func() {
		service.Shutdown()
		close(shutdownDone)
	}()
	require.Eventually(t, service.isStopped, time.Second, time.Millisecond)
	service.operationMu.Unlock()

	assert.ErrorIs(t, <-saveDone, errSyncServiceStopped)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("sync shutdown did not finish after the active operation released")
	}
	_, err := service.LoadConfig()
	assert.ErrorIs(t, err, errSyncServiceStopped)
}

func TestSyncServiceShutdownWaitsForActiveReadOperations(t *testing.T) {
	tests := []struct {
		name string
		call func(*SyncService) error
	}{
		{name: "load config", call: func(service *SyncService) error { _, err := service.LoadConfig(); return err }},
		{name: "dashboard", call: func(service *SyncService) error { _, err := service.Dashboard(); return err }},
		{name: "list versions", call: func(service *SyncService) error { _, err := service.ListVersions(); return err }},
		{name: "list events", call: func(service *SyncService) error { _, err := service.ListEvents(); return err }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			database := testutil.NewTestDB(t)
			service := newTestSyncService(database, syncTestMasterKey)
			assertDatabaseServiceShutdownWaits(t, database, func() error {
				return test.call(service)
			}, service.Shutdown)
		})
	}
}

func TestSyncServiceRejectsReadOperationsAfterShutdown(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	service.Shutdown()

	_, err := service.LoadConfig()
	assert.ErrorIs(t, err, errSyncServiceStopped)
	_, err = service.Dashboard()
	assert.ErrorIs(t, err, errSyncServiceStopped)
	_, err = service.ListVersions()
	assert.ErrorIs(t, err, errSyncServiceStopped)
	_, err = service.ListEvents()
	assert.ErrorIs(t, err, errSyncServiceStopped)
}

func TestSyncServiceRejectsAllMutationsAfterShutdown(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	service.Shutdown()
	path := filepath.Join(t.TempDir(), "backup.msshbackup")
	for _, test := range stoppedSyncMutationCases(service, path) {
		t.Run(test.name, func(t *testing.T) {
			assert.ErrorIs(t, test.call(), errSyncServiceStopped)
		})
	}
}

type stoppedSyncMutationCase struct {
	name string
	call func() error
}

func stoppedSyncMutationCases(service *SyncService, path string) []stoppedSyncMutationCase {
	return []stoppedSyncMutationCase{
		{name: "export", call: func() error { return service.Export(path) }},
		{name: "import", call: func() error { return service.Import(path) }},
		{name: "password import", call: func() error { return service.ImportWithPassword(path, "password-123") }},
		{name: "adopt vault", call: func() error { return service.AdoptVaultFromContent("password-123", []byte("payload")) }},
		{name: "restore version", call: func() error { return service.RestoreVersion(1) }},
		{name: "reset", call: service.ResetLocalData},
		{name: "delete version", call: func() error { return service.DeleteVersion(1) }},
		{name: "resolve conflict", call: func() error { _, err := service.ResolveConflict(model.SyncConflictCancel); return err }},
		{name: "sync now", call: func() error { _, err := service.SyncNow(); return err }},
		{name: "test provider", call: func() error { return service.TestProvider(syncTestConfigInput()) }},
		{name: "save config", call: func() error { _, err := service.SaveConfig(syncTestConfigInput()); return err }},
		{name: "join", call: func() error { _, err := service.JoinWithPassword(syncTestConfigInput(), "password-123"); return err }},
		{name: "legacy test", call: func() error { return service.TestCloudConnection("https://sync.example.test/backup", "", "") }},
		{name: "legacy upload", call: func() error { return service.SyncToCloud("https://sync.example.test/backup", "", "") }},
		{name: "legacy download", call: func() error { return service.SyncFromCloud("https://sync.example.test/backup", "", "") }},
	}
}

func TestSyncServiceShutdownCancelsLegacyCloudRequests(t *testing.T) {
	tests := []struct {
		name string
		call func(*SyncService, string) error
	}{
		{name: "connection test", call: func(service *SyncService, endpoint string) error {
			return service.TestCloudConnection(endpoint, "", "")
		}},
		{name: "upload", call: func(service *SyncService, endpoint string) error { return service.SyncToCloud(endpoint, "", "") }},
		{name: "download", call: func(service *SyncService, endpoint string) error { return service.SyncFromCloud(endpoint, "", "") }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertLegacyCloudRequestCancelledOnShutdown(t, test.call)
		})
	}
}

func assertLegacyCloudRequestCancelledOnShutdown(t *testing.T, call func(*SyncService, string) error) {
	t.Helper()
	requestStarted := make(chan struct{})
	releaseHandler := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(requestStarted)
		select {
		case <-request.Context().Done():
		case <-releaseHandler:
		}
	}))
	t.Cleanup(server.Close)
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	requestDone := make(chan error, 1)
	go func() { requestDone <- call(service, server.URL) }()
	<-requestStarted

	service.Shutdown()
	requestErr := <-requestDone
	close(releaseHandler)
	assert.Error(t, requestErr)
	assert.ErrorContains(t, requestErr, "context canceled")
}

func TestNilSyncServiceShutdownAndOperationBoundaries(t *testing.T) {
	var service *SyncService
	service.Shutdown()
	assert.ErrorIs(t, service.beginSyncOperation(), errSyncServiceStopped)
	assert.ErrorIs(t, service.lockSyncOperation(), errSyncServiceStopped)
	_, err := service.beginReadOperation()
	assert.ErrorIs(t, err, errSyncServiceStopped)
	_, _, err = service.beginCancelableSyncOperation(t.Context())
	assert.ErrorIs(t, err, errSyncServiceStopped)

	service = NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger())
	_, _, err = service.beginCancelableSyncOperation(nil)
	assert.ErrorContains(t, err, "context is required")
}
