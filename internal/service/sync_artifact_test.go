package service

import (
	"encoding/json"
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

func TestSyncArtifactAuthenticatesMetadata(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	metadata := syncArtifactMetadata{
		VersionID: "version-2", VersionNumber: 2, ParentVersionID: "version-1",
		SnapshotFingerprint: fingerprint, DeviceID: "device-1", CreatedAt: time.Now().UTC(),
	}
	content, err := encodeSyncArtifact(data, syncTestMasterKey, metadata, nil)
	require.NoError(t, err)

	tests := []struct {
		name   string
		mutate func(*syncArtifactMetadata)
	}{
		{name: "version number", mutate: func(value *syncArtifactMetadata) { value.VersionNumber++ }},
		{name: "parent version", mutate: func(value *syncArtifactMetadata) { value.ParentVersionID = "attacker-parent" }},
		{name: "device", mutate: func(value *syncArtifactMetadata) { value.DeviceID = "attacker-device" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var artifact syncArtifact
			require.NoError(t, json.Unmarshal(content, &artifact))
			test.mutate(&artifact.Metadata)
			tampered, marshalErr := json.Marshal(artifact)
			require.NoError(t, marshalErr)
			_, decodeErr := decodeSyncArtifact(tampered, syncTestMasterKey)
			assert.ErrorContains(t, decodeErr, "corrupted backup")
		})
	}
}

func TestSyncArtifactAuthenticatesEmbeddedVault(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	vault, _, err := backupcrypto.CreateVault("vault-pass-1234")
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, syncTestMasterKey, syncArtifactMetadata{SnapshotFingerprint: fingerprint}, &vault)
	require.NoError(t, err)

	var artifact syncArtifact
	require.NoError(t, json.Unmarshal(content, &artifact))
	artifact.Vault.UpdatedAt = "tampered"
	tampered, err := json.Marshal(artifact)
	require.NoError(t, err)

	_, err = decodeSyncArtifact(tampered, syncTestMasterKey)
	assert.ErrorContains(t, err, "corrupted backup")
}

func TestSyncArtifactRejectsUnauthenticatedVersionOne(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, syncTestMasterKey, syncArtifactMetadata{SnapshotFingerprint: fingerprint}, nil)
	require.NoError(t, err)
	var artifact syncArtifact
	require.NoError(t, json.Unmarshal(content, &artifact))
	artifact.ArtifactVersion = 1
	downgraded, err := json.Marshal(artifact)
	require.NoError(t, err)

	_, err = decodeSyncArtifact(downgraded, syncTestMasterKey)
	assert.ErrorContains(t, err, "unsupported sync artifact version 1")
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
