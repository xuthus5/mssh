package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSyncArtifactRoundTripAndLegacyCompatibility(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSyncService(db, testutil.NewTestLogger())
	data, err := service.snapshot()
	require.NoError(t, err)
	fingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)
	metadata := syncArtifactMetadata{VersionID: "version-1", VersionNumber: 3, SnapshotFingerprint: fingerprint, DeviceID: "device-1", CreatedAt: time.Now().UTC()}
	content, err := encodeSyncArtifact(data, syncTestMasterKey, metadata)
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
	data, err := NewSyncService(db, testutil.NewTestLogger()).snapshot()
	require.NoError(t, err)
	content, err := encodeSyncArtifact(data, syncTestMasterKey, syncArtifactMetadata{SnapshotFingerprint: "wrong", CreatedAt: time.Now().UTC()})
	require.NoError(t, err)
	_, err = decodeSyncArtifact(content, syncTestMasterKey)
	assert.ErrorContains(t, err, "fingerprint")
}
