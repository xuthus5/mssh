package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestFinishDownloadedSyncReappliesRestoredProxySettings(t *testing.T) {
	remoteDatabase := testutil.NewTestDB(t)
	require.NoError(t, store.SetSettings(remoteDatabase, []model.Setting{{
		Key: applicationProxyModeSetting, Namespace: "application", Value: `"direct"`, ValueType: "string", Version: 1,
	}}))
	remoteData, err := newTestSyncService(remoteDatabase, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	require.Contains(t, remoteData.Tables, "settings")
	require.NotEmpty(t, remoteData.Tables["settings"])
	fingerprint, err := snapshotFingerprint(remoteData)
	require.NoError(t, err)

	localDatabase := testutil.NewTestDB(t)
	version := insertSyncVersionForCommitTest(t, localDatabase, "remote-version", fingerprint)
	manager := netproxy.New()
	settings := NewSettingService(localDatabase, testutil.NewTestLogger(), SettingServiceOptions{Proxy: manager})
	service := newTestSyncService(localDatabase, syncTestMasterKey, WithSyncRuntimeSettings(settings))
	config := defaultSyncConfig()
	config.Provider = model.SyncProviderWebDAV

	err = service.finishDownloadedSync(syncCompletion{
		Config: config,
		Metadata: syncArtifactMetadata{
			VersionID: "remote-version", VersionNumber: 1, SnapshotFingerprint: fingerprint, CreatedAt: time.Now().UTC(),
		},
		ETag: `"remote"`, LocalVersionID: version.ID,
	}, remoteData)

	require.NoError(t, err)
	stored, err := store.GetSettingEntry(localDatabase, applicationProxyModeSetting)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, `"direct"`, stored.Value)
	assert.Equal(t, netproxy.ModeDirect, manager.Config().Mode)
}
