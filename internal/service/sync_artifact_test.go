package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSyncArtifactRoundTripAndLegacyCompatibility(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey)
	data, err := service.snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	metadata := syncArtifactMetadata{VersionID: "version-1", VersionNumber: 3, SnapshotFingerprint: fingerprint, DeviceID: "device-1", CreatedAt: time.Now().UTC()}
	content, err := encodeSyncArtifact(data, syncTestMasterKey, metadata, nil)
	require.NoError(t, err)
	decoded, err := decodeSyncArtifact(content, syncTestMasterKey)
	require.NoError(t, err)
	assert.Equal(t, metadata, decoded.Metadata)

	legacy, err := encodeEncryptedSnapshot(data, syncTestMasterKey)
	require.NoError(t, err)
	decoded, err = decodeSyncArtifact(legacy, syncTestMasterKey)
	require.NoError(t, err)
	assert.Equal(t, fingerprint, decoded.Metadata.SnapshotFingerprint)
}

func TestSyncArtifactRejectsTamperedFingerprint(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, syncTestMasterKey, syncArtifactMetadata{SnapshotFingerprint: "wrong", CreatedAt: time.Now().UTC()}, nil)
	require.NoError(t, err)
	_, err = decodeSyncArtifact(content, syncTestMasterKey)
	assert.ErrorContains(t, err, "fingerprint")
}

func TestSyncArtifactEmbedsVaultEnvelope(t *testing.T) {
	vault, dek, err := backupcrypto.CreateVault("vault-pass-1234")
	require.NoError(t, err)
	secret := backupcrypto.SyncSecretFromDEK(dek)
	db := testutil.NewTestDB(t)
	data, err := newTestSyncService(db, secret).snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, secret, syncArtifactMetadata{SnapshotFingerprint: fingerprint, CreatedAt: time.Now().UTC()}, &vault)
	require.NoError(t, err)
	decoded, err := decodeSyncArtifact(content, secret)
	require.NoError(t, err)
	require.NotNil(t, decoded.Vault)
	assert.Equal(t, vault.WrappedDEK, decoded.Vault.WrappedDEK)
	peeked, err := peekSyncArtifactVault(content)
	require.NoError(t, err)
	assert.Equal(t, vault.Salt, peeked.Salt)
}
