package service

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSyncEnginePullReportsForeignVault(t *testing.T) {
	content, remoteVault := remoteArtifactWithVault(t, "remote-device-pass-12")
	require.NotNil(t, remoteVault)
	localVault, localDEK, err := backupcrypto.CreateVault("local-device-pass-12")
	require.NoError(t, err)
	defer clear(localDEK)

	provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content, ETag: `"remote"`}}
	service := newTestSyncService(testutil.NewTestDB(t), backupcrypto.SyncSecretFromDEK(localDEK),
		WithVaultSource(func() (*backupcrypto.VaultFile, error) { return &localVault, nil }),
		WithSyncProviderFactory(fakeSyncProviderFactory{provider}),
	)
	_, err = service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)

	_, err = service.PullNow()
	require.Error(t, err)
	assert.ErrorContains(t, err, "从云端恢复此设备")
	assert.NotContains(t, err.Error(), "corrupted backup")
}

func TestSyncEnginePullKeepsCorruptionErrorForMatchingVault(t *testing.T) {
	content, vault := remoteArtifactWithVault(t, "matching-device-pass-12")
	require.NotNil(t, vault)
	dek, err := backupcrypto.UnlockVault("matching-device-pass-12", *vault)
	require.NoError(t, err)
	defer clear(dek)
	content = corruptArtifactCiphertext(t, content)

	provider := &fakeSyncProvider{remote: syncRemoteObject{Content: content, ETag: `"remote"`}}
	service := newTestSyncService(testutil.NewTestDB(t), backupcrypto.SyncSecretFromDEK(dek),
		WithVaultSource(func() (*backupcrypto.VaultFile, error) { return vault, nil }),
		WithSyncProviderFactory(fakeSyncProviderFactory{provider}),
	)
	_, err = service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)

	_, err = service.PullNow()
	require.Error(t, err)
	assert.ErrorContains(t, err, "invalid master key or corrupted backup")
	assert.NotContains(t, err.Error(), "从云端恢复此设备")
}

func remoteArtifactWithVault(t *testing.T, password string) ([]byte, *backupcrypto.VaultFile) {
	t.Helper()
	vault, dek, err := backupcrypto.CreateVault(password)
	require.NoError(t, err)
	secret := backupcrypto.SyncSecretFromDEK(dek)
	data, err := newTestSyncService(testutil.NewTestDB(t), secret).snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, secret, syncArtifactMetadata{
		SnapshotFingerprint: fingerprint, DeviceID: "remote-device", CreatedAt: time.Now().UTC(),
	}, &vault)
	require.NoError(t, err)
	return content, &vault
}

func corruptArtifactCiphertext(t *testing.T, content []byte) []byte {
	t.Helper()
	var artifact syncArtifact
	require.NoError(t, json.Unmarshal(content, &artifact))
	ciphertext, err := base64.StdEncoding.DecodeString(artifact.Backup.Ciphertext)
	require.NoError(t, err)
	ciphertext[len(ciphertext)-1] ^= 0xff
	artifact.Backup.Ciphertext = base64.StdEncoding.EncodeToString(ciphertext)
	corrupted, err := json.Marshal(artifact)
	require.NoError(t, err)
	return corrupted
}
