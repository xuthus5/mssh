package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

type gateHoldingSyncProvider struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (p *gateHoldingSyncProvider) Test(context.Context) error { return nil }

func (p *gateHoldingSyncProvider) Fetch(ctx context.Context) (syncRemoteObject, error) {
	p.once.Do(func() { close(p.started) })
	select {
	case <-p.release:
		return syncRemoteObject{}, errSyncRemoteNotFound
	case <-ctx.Done():
		return syncRemoteObject{}, ctx.Err()
	}
}

func (p *gateHoldingSyncProvider) Put(_ context.Context, content []byte, _ string) (syncRemoteObject, error) {
	return syncRemoteObject{Content: append([]byte(nil), content...), ETag: `"uploaded"`}, nil
}

type gateHoldingSyncProviderFactory struct{ provider *gateHoldingSyncProvider }

func (f gateHoldingSyncProviderFactory) Create(context.Context, model.SyncConfig, syncProviderSecrets) (syncProvider, error) {
	return f.provider, nil
}

func TestSyncEngineHoldsCryptoGateAcrossRemotePhase(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	runtime.SetDEK(make([]byte, 32))
	provider := &gateHoldingSyncProvider{started: make(chan struct{}), release: make(chan struct{})}
	service := newTestSyncService(db, syncTestMasterKey,
		WithSyncCrypto(runtime),
		WithSyncDataDir(t.TempDir()),
		WithSyncProviderFactory(gateHoldingSyncProviderFactory{provider: provider}),
	)
	require.NoError(t, saveTestSyncConfig(service))

	syncDone := make(chan error, 1)
	go func() {
		_, err := service.SyncNow()
		syncDone <- err
	}()
	waitForGateSignal(t, provider.started)

	gateAcquired := make(chan struct{})
	gateDone := make(chan error, 1)
	go func() {
		gateDone <- runtime.WithCryptoOperation(func() error {
			close(gateAcquired)
			return nil
		})
	}()
	assertGateWaits(t, gateAcquired)

	close(provider.release)
	require.NoError(t, <-syncDone)
	require.NoError(t, <-gateDone)
}

func TestRestoreVersionWaitsForCryptoGate(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	service := newTestSyncService(db, syncTestMasterKey,
		WithSyncCrypto(runtime), WithSyncDataDir(t.TempDir()))
	require.NoError(t, saveTestSyncConfig(service))
	version, err := service.saveCurrentVersion(model.SyncProviderWebDAV, "test", false)
	require.NoError(t, err)

	_, release, gateDone := startHeldCryptoGate(runtime)
	restoreDone := make(chan error, 1)
	go func() { restoreDone <- service.RestoreVersion(version.ID) }()
	assertNotCompleted(t, restoreDone)
	close(release)
	require.NoError(t, <-restoreDone)
	require.NoError(t, <-gateDone)
}

func TestResetLocalDataWaitsForCryptoGate(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	service := newTestSyncService(db, syncTestMasterKey,
		WithSyncCrypto(runtime), WithSyncDataDir(t.TempDir()))
	require.NoError(t, saveTestSyncConfig(service))

	_, release, gateDone := startHeldCryptoGate(runtime)
	resetDone := make(chan error, 1)
	go func() { resetDone <- service.ResetLocalData() }()
	assertNotCompleted(t, resetDone)
	close(release)
	require.NoError(t, <-resetDone)
	require.NoError(t, <-gateDone)
}

func TestCloudUploadHoldsCryptoGateUntilRemoteCommit(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	serverStarted := make(chan struct{})
	serverRelease := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		close(serverStarted)
		<-serverRelease
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	service := newTestSyncService(db, syncTestMasterKey, WithSyncCrypto(runtime))

	uploadDone := make(chan error, 1)
	go func() { uploadDone <- service.SyncToCloud(server.URL, "", "") }()
	waitForGateSignal(t, serverStarted)

	gateAcquired := make(chan struct{})
	gateDone := make(chan error, 1)
	go func() {
		gateDone <- runtime.WithCryptoOperation(func() error {
			close(gateAcquired)
			return nil
		})
	}()
	assertGateWaits(t, gateAcquired)

	close(serverRelease)
	require.NoError(t, <-uploadDone)
	require.NoError(t, <-gateDone)
}

func TestImportWithPasswordWaitsForCryptoGateAcrossVaultRestore(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	dataDir := t.TempDir()
	security := NewSecurityService(db, dataDir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	password := "import-gate-pass-12"
	vault, dek, err := backupcrypto.CreateVault(password)
	require.NoError(t, err)
	secret := backupcrypto.SyncSecretFromDEK(dek)
	service := NewSyncService(db, testutil.NewTestLogger(),
		WithSyncDataDir(dataDir),
		WithSyncCrypto(runtime),
		WithSyncSecretSource(security.SyncSecret),
		WithVaultTransactionInstaller(security.PrepareVaultFromExport),
	)
	data, err := service.snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, secret, syncArtifactMetadata{SnapshotFingerprint: fingerprint}, &vault)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "import.msshbackup")
	require.NoError(t, writePrivateFileAtomic(path, content))

	_, release, gateDone := startHeldCryptoGate(runtime)
	importDone := make(chan error, 1)
	go func() { importDone <- service.ImportWithPassword(path, password) }()
	assertNotCompleted(t, importDone)
	close(release)
	require.NoError(t, <-importDone)
	require.NoError(t, <-gateDone)
}

func saveTestSyncConfig(service *SyncService) error {
	_, err := service.SaveConfig(model.SyncConfigInput{
		Enabled: true, Provider: model.SyncProviderWebDAV, Strategy: model.SyncStrategySmart,
		IntervalMinutes: 0, RetentionCount: 1, RetentionDays: 1,
		WebDAV: model.WebDAVSyncConfigInput{URL: "https://dav.example/backups"},
	})
	return err
}

func startHeldCryptoGate(runtime *CryptoRuntime) (<-chan struct{}, chan struct{}, <-chan error) {
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- runtime.WithCryptoOperation(func() error {
			close(started)
			<-release
			return nil
		})
	}()
	waitForGateSignalValue(started)
	return started, release, done
}

func waitForGateSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatal("operation did not reach the synchronization point")
	}
}

func waitForGateSignalValue(signal <-chan struct{}) {
	select {
	case <-signal:
	case <-time.After(time.Second):
		panic("crypto gate did not start")
	}
}

func assertGateWaits(t *testing.T, completed <-chan struct{}) {
	t.Helper()
	select {
	case <-completed:
		t.Fatal("crypto operation completed while synchronization was active")
	case <-time.After(100 * time.Millisecond):
	}
}

func assertNotCompleted(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		t.Fatalf("operation completed while synchronization was active: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
}
