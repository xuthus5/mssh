package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestInstallVaultFromExportConflictAndIdempotent(t *testing.T) {
	dbA := testutil.NewTestDB(t)
	dirA := t.TempDir()
	svcA := NewSecurityService(dbA, dirA, NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	_, err := svcA.Setup(model.SecuritySetupInput{Password: "initial-pass-12"})
	require.NoError(t, err)
	vaultA, err := svcA.ExportVaultFile()
	require.NoError(t, err)

	dbB := testutil.NewTestDB(t)
	dirB := t.TempDir()
	svcB := NewSecurityService(dbB, dirB, NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	assert.Error(t, svcB.InstallVaultFromExport("wrong-password1", vaultA))
	require.NoError(t, svcB.InstallVaultFromExport("initial-pass-12", vaultA))
	require.NoError(t, svcB.InstallVaultFromExport("initial-pass-12", vaultA))

	dbC := testutil.NewTestDB(t)
	dirC := t.TempDir()
	svcC := NewSecurityService(dbC, dirC, NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	_, err = svcC.Setup(model.SecuritySetupInput{Password: "another-pass-12"})
	require.NoError(t, err)
	vaultC, err := svcC.ExportVaultFile()
	require.NoError(t, err)
	assert.Error(t, svcB.InstallVaultFromExport("another-pass-12", vaultC))

	empty := NewSecurityService(testutil.NewTestDB(t), t.TempDir(), NewCryptoRuntime(), &memoryKeychain{}, testutil.NewTestLogger())
	_, err = empty.ExportVaultFile()
	assert.Error(t, err)
	assert.True(t, crypto.VaultExists(dirB))
}

func TestFileTransferCancelMidUpload(t *testing.T) {
	sftpCtx := startSFTPTestServer(t)
	defer sftpCtx.cancel()
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	port := parsePort(t, sftpCtx.addr)
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "cancel-up", Host: "127.0.0.1", Port: port, Username: "test",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	bus := newMockEventBus()
	svc := NewFileService(sessionSvc, bus, testutil.NewTestLogger(), WithTransferDB(db))

	local := filepath.Join(t.TempDir(), "big.bin")
	payload := make([]byte, 2<<20)
	for i := range payload {
		payload[i] = byte(i)
	}
	require.NoError(t, os.WriteFile(local, payload, 0o600))
	taskID, err := svc.Upload(created.ID, local, "/big.bin")
	require.NoError(t, err)
	_ = svc.CancelTransfer(taskID)
	require.Eventually(t, func() bool {
		for _, captured := range bus.Events() {
			if captured.Name == event.TransferComplete || captured.Name == event.TransferError {
				return true
			}
		}
		jobs, listErr := store.ListTransferJobs(db)
		if listErr != nil {
			return false
		}
		for _, job := range jobs {
			if job.ID == taskID && job.Status != "running" && job.Status != "" {
				return true
			}
		}
		return false
	}, 5*time.Second, 20*time.Millisecond)
}

func TestFileTransferDownloadRenameFailure(t *testing.T) {
	sftpCtx := startSFTPTestServer(t)
	defer sftpCtx.cancel()
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	port := parsePort(t, sftpCtx.addr)
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "dl-rename", Host: "127.0.0.1", Port: port, Username: "test",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	bus := newMockEventBus()
	svc := NewFileService(sessionSvc, bus, testutil.NewTestLogger(), WithTransferDB(db))

	local := filepath.Join(t.TempDir(), "seed.txt")
	require.NoError(t, os.WriteFile(local, []byte("seed-data"), 0o600))
	upID, err := svc.Upload(created.ID, local, "/seed.txt")
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		jobs, listErr := store.ListTransferJobs(db)
		if listErr != nil {
			return false
		}
		for _, job := range jobs {
			if job.ID == upID && job.Status == "completed" {
				return true
			}
		}
		return false
	}, 3*time.Second, 20*time.Millisecond)

	targetDir := t.TempDir()
	taskID, err := svc.Download(created.ID, "/seed.txt", targetDir)
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		for _, captured := range bus.Events() {
			if captured.Name == event.TransferError {
				return true
			}
		}
		jobs, listErr := store.ListTransferJobs(db)
		if listErr != nil {
			return false
		}
		for _, job := range jobs {
			if job.ID == taskID && job.Status == "failed" {
				return true
			}
		}
		return false
	}, 5*time.Second, 20*time.Millisecond)
}

func TestTunnelStartAlreadyRunningAndMissing(t *testing.T) {
	db := testutil.NewTestDB(t)
	bus := newMockEventBus()
	sessionSvc := NewSessionService(db, bus, 30, t.TempDir(), nil, testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, bus, testutil.NewTestLogger())
	svc.mu.Lock()
	svc.tunnels[99] = &TunnelState{ID: 99, starting: true}
	svc.mu.Unlock()
	assert.Error(t, svc.Start(99))
	assert.Error(t, svc.Start(123456))
}

func TestSyncHistoryDeleteVersionPaths(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(dir),
		WithSyncSecretSource(func() (string, error) { return "secret-from-vault-xx", nil }),
	)
	require.NoError(t, svc.ensureVersionDirectory())
	versionDir := filepath.Join(dir, "sync", "versions")
	fileName := "v-test.msshbackup"
	require.NoError(t, os.WriteFile(filepath.Join(versionDir, fileName), []byte("data"), 0o600))
	version, err := store.InsertSyncVersion(db, model.SyncVersion{
		VersionID: "vid-1", VersionNumber: 1, SnapshotFingerprint: "fp-x",
		Provider: model.SyncProviderGist, Source: "local", FileName: fileName, SizeBytes: 4,
		CreatedAt: time.Now().UTC(),
	})
	require.NoError(t, err)
	require.NoError(t, svc.DeleteVersion(version.ID))

	version, err = store.InsertSyncVersion(db, model.SyncVersion{
		VersionID: "vid-2", VersionNumber: 2, SnapshotFingerprint: "fp-y",
		Provider: model.SyncProviderGist, Source: "local", FileName: fileName, SizeBytes: 4,
		Protected: true, CreatedAt: time.Now().UTC(),
	})
	require.NoError(t, err)
	err = svc.DeleteVersion(version.ID)
	assert.Error(t, err)
	got, getErr := store.GetSyncVersion(db, version.ID)
	require.NoError(t, getErr)
	require.NotNil(t, got)
	assert.True(t, got.Protected)
}

func TestSessionCRUDUpdateAndDeleteImpact(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 1)
	}
	runtime.SetDEK(dek)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), runtime, testutil.NewTestLogger())
	created, err := svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "crud", Host: "2.2.2.2", Port: 22, Username: "u",
		AuthMethod: model.AuthPassword, Password: "p@ss", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	require.NoError(t, svc.UpdateSession(model.SessionInputFrom(model.Session{
		ID: created.ID, Name: "crud2", Host: "2.2.2.2", Port: 22, Username: "u",
		AuthMethod: model.AuthPassword, Password: "", KeepAlive: 60, TermType: "xterm",
	})))
	impact, err := svc.SessionDeleteImpact(created.ID)
	require.NoError(t, err)
	assert.NotNil(t, impact)
	require.NoError(t, svc.DeleteSession(created.ID))
}

func TestWriteRecoveryPointPath(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()),
		WithSyncSecretSource(func() (string, error) { return "secret-from-vault-xx", nil }),
	)
	require.NoError(t, svc.writeRecoveryPoint("secret-from-vault-xx"))
	path, err := svc.recoveryPath()
	require.NoError(t, err)
	assert.FileExists(t, path)
}

func TestWritePrivateFileAtomicCreatesParents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "dir", "file.bin")
	require.NoError(t, writePrivateFileAtomic(path, []byte("payload")))
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "payload", string(content))
}

func TestOpenAgentAuthMissingSocket(t *testing.T) {
	t.Setenv("SSH_AUTH_SOCK", filepath.Join(t.TempDir(), "no.sock"))
	_, err := openAgentAuth()
	assert.Error(t, err)
}
