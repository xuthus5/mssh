package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSSHJumpHostBackupRestoresEncryptedCredentials(t *testing.T) {
	sourceDB := testutil.NewTestDB(t)
	runtime := newUnlockedSessionTestCrypto()
	sessions := NewSessionService(sourceDB, newMockEventBus(), 30, t.TempDir(), runtime, testutil.NewTestLogger())
	created, err := sessions.CreateSession(jumpHostSessionInput())
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "jump.msshbackup")
	require.NoError(t, newTestSyncService(sourceDB, syncTestMasterKey).Export(path))
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.NotContains(t, string(content), "target-secret")
	assert.NotContains(t, string(content), "jump-secret")
	targetDB := testutil.NewTestDB(t)
	require.NoError(t, newTestSyncService(targetDB, syncTestMasterKey).Import(path))
	restored := NewSessionService(targetDB, newMockEventBus(), 30, t.TempDir(), runtime, testutil.NewTestLogger())
	loaded, err := restored.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "bastion.example", loaded.JumpHost.Host)
	assert.Equal(t, "target-secret", loaded.Password)
	assert.Equal(t, "jump-secret", loaded.JumpHost.Password)
}

func TestSSHJumpHostBackupAcceptsLegacyDisabledSessions(t *testing.T) {
	sourceDB := testutil.NewTestDB(t)
	data, err := newTestSyncService(sourceDB, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	data.Tables["sessions"] = []map[string]any{snapshotSessionRow("")}
	content, err := encodeEncryptedSnapshot(data, syncTestMasterKey)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "legacy.msshbackup")
	require.NoError(t, writePrivateFileAtomic(path, content))
	targetDB := testutil.NewTestDB(t)
	require.NoError(t, newTestSyncService(targetDB, syncTestMasterKey).Import(path))
	session, err := store.GetSession(targetDB, 1)
	require.NoError(t, err)
	assert.Nil(t, session.JumpHost)
}

func TestSSHJumpHostBackupRestoresCredentialsOnFreshVault(t *testing.T) {
	password := "jump-backup-pass-12"
	sourceDB := testutil.NewTestDB(t)
	sourceRuntime := NewCryptoRuntime()
	sourceSecurity := NewSecurityService(sourceDB, t.TempDir(), sourceRuntime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := sourceSecurity.Setup(model.SecuritySetupInput{Password: password})
	require.NoError(t, err)
	sessions := NewSessionService(sourceDB, newMockEventBus(), 30, t.TempDir(), sourceRuntime, testutil.NewTestLogger())
	created, err := sessions.CreateSession(jumpHostSessionInput())
	require.NoError(t, err)
	secret, err := sourceSecurity.SyncSecret()
	require.NoError(t, err)
	vault, err := sourceSecurity.ExportVaultFile()
	require.NoError(t, err)
	sourceSync := newTestSyncService(sourceDB, secret, WithSyncCrypto(sourceRuntime), WithVaultSource(func() (*backupcrypto.VaultFile, error) { return &vault, nil }))
	path := filepath.Join(t.TempDir(), "jump-vault.msshbackup")
	require.NoError(t, sourceSync.Export(path))
	targetDB := testutil.NewTestDB(t)
	targetRuntime := NewCryptoRuntime()
	targetSecurity := NewSecurityService(targetDB, t.TempDir(), targetRuntime, &memoryKeychain{}, testutil.NewTestLogger())
	targetSync := newTestSyncService(targetDB, "unused", WithSyncCrypto(targetRuntime), WithSyncSecretSource(targetSecurity.SyncSecret),
		WithVaultTransactionInstaller(targetSecurity.PrepareVaultFromExport))
	require.NoError(t, targetSync.ImportWithPassword(path, password))
	restored := NewSessionService(targetDB, newMockEventBus(), 30, t.TempDir(), targetRuntime, testutil.NewTestLogger())
	loaded, err := restored.sessionForConnect(created.ID)
	require.NoError(t, err)
	assert.Equal(t, "target-secret", loaded.Password)
	assert.Equal(t, "jump-secret", loaded.JumpHost.Password)
}

func TestSnapshotRejectsInvalidSSHJumpHostCredentials(t *testing.T) {
	tests := []struct {
		field string
		value any
	}{
		{field: "jump_password", value: "plaintext"},
		{field: "jump_password", value: nil},
		{field: "jump_host", value: ""},
		{field: "jump_username", value: ""},
		{field: "jump_port", value: int64(0)},
		{field: "jump_auth_method", value: "unsupported"},
		{field: "jump_key_id", value: int64(-1)},
	}
	for _, test := range tests {
		t.Run(test.field, func(t *testing.T) {
			row := snapshotJumpHostSessionRow(t)
			row[test.field] = test.value
			require.Error(t, validateSnapshotSessions([]map[string]any{row}))
		})
	}
}

func TestSnapshotRejectsPartialSSHJumpHostFields(t *testing.T) {
	for _, field := range []string{"jump_host", "jump_port", "jump_username", "jump_auth_method", "jump_password", "jump_key_id"} {
		t.Run(field, func(t *testing.T) {
			row := snapshotJumpHostSessionRow(t)
			delete(row, field)
			require.ErrorContains(t, validateSnapshotSessions([]map[string]any{row}), field)
		})
	}
}

func TestSnapshotDisabledSSHJumpHostRequiresClearedCredentials(t *testing.T) {
	row := snapshotSessionRow("")
	row["jump_host"] = ""
	row["jump_port"] = int64(22)
	row["jump_username"] = ""
	row["jump_auth_method"] = "password"
	row["jump_password"] = ""
	row["jump_key_id"] = nil
	require.NoError(t, validateSnapshotSessions([]map[string]any{row}))
	row["jump_key_id"] = int64(7)
	require.ErrorContains(t, validateSnapshotSessions([]map[string]any{row}), "disabled SSH jump host")
}

func snapshotJumpHostSessionRow(t *testing.T) map[string]any {
	t.Helper()
	row := snapshotSessionRow(testStoredSessionPassword(t, "target-secret"))
	row["jump_host"] = "bastion.example"
	row["jump_port"] = int64(2222)
	row["jump_username"] = "jump"
	row["jump_auth_method"] = "password"
	row["jump_password"] = testStoredSessionPassword(t, "jump-secret")
	row["jump_key_id"] = nil
	return row
}
