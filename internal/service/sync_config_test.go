package service

import (
	"database/sql"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	appcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type syncTestCrypto struct{ key []byte }

func (s syncTestCrypto) Encrypt(value []byte) ([]byte, error) { return appcrypto.Encrypt(value, s.key) }

func (s syncTestCrypto) Decrypt(value []byte) ([]byte, error) { return appcrypto.Decrypt(value, s.key) }

func TestSyncConfigEncryptsProviderSecretsAndExcludesSyncSettings(t *testing.T) {
	db := testutil.NewTestDB(t)
	crypto := syncTestCrypto{key: []byte("01234567890123456789012345678901")}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncDataDir(t.TempDir()), WithSyncCrypto(crypto))
	input := model.SyncConfigInput{
		Enabled: true, Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart,
		IntervalMinutes: 15, RetentionCount: 30, RetentionDays: 90, MasterKey: syncTestMasterKey,
		Gist:   model.GistSyncConfigInput{GistID: "gist-1", Token: "github-secret-token"},
		WebDAV: model.WebDAVSyncConfigInput{URL: "https://dav.example/backups", Username: "alice", Password: "dav-secret"},
		S3:     model.S3SyncConfigInput{Region: "us-east-1", Bucket: "backups", AccessKeyID: "access", SecretKey: "s3-secret"},
	}
	dashboard, err := service.SaveConfig(input)
	require.NoError(t, err)
	assert.True(t, dashboard.Config.Gist.TokenSaved)
	assert.True(t, dashboard.Config.WebDAV.PasswordSaved)
	assert.True(t, dashboard.Config.S3.SecretKeySaved)

	for key, secret := range map[string]string{syncGistTokenSetting: input.Gist.Token, syncWebDAVPasswordSetting: input.WebDAV.Password, syncS3SecretSetting: input.S3.SecretKey} {
		var raw string
		require.NoError(t, db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&raw))
		assert.NotContains(t, raw, secret)
	}

	snapshot, err := service.snapshot()
	require.NoError(t, err)
	encoded, err := json.Marshal(snapshot.Tables["settings"])
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "sync.")
}

func TestSyncSnapshotAndRestoreKeepLocalSecurityRotationMarker(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := newTestSyncService(db, syncTestMasterKey)
	require.NoError(t, store.SetSettings(db, []model.Setting{{
		Key: securityRotationPendingSetting, Namespace: "security", Value: `{"version":1}`, ValueType: "object", Version: 1,
	}}))

	snapshot, err := service.snapshot()
	require.NoError(t, err)
	encoded, err := json.Marshal(snapshot.Tables["settings"])
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), securityRotationPendingSetting)
	require.NoError(t, service.restore(snapshot))
	entry, err := store.GetSettingEntry(db, securityRotationPendingSetting)
	require.NoError(t, err)
	assert.NotNil(t, entry)
}

func TestValidateSyncConfigRejectsUnsupportedValues(t *testing.T) {
	config := defaultSyncConfig()
	config.IntervalMinutes = 7
	assert.ErrorContains(t, validateSyncConfig(config), "interval")
	config = defaultSyncConfig()
	config.RetentionCount = 0
	assert.ErrorContains(t, validateSyncConfig(config), "retention")
	config = defaultSyncConfig()
	config.Provider = "unknown"
	assert.ErrorContains(t, validateSyncConfig(config), "provider")
}

func TestSyncConfigLoadsAndClearsEncryptedSecrets(t *testing.T) {
	db := testutil.NewTestDB(t)
	crypto := syncTestCrypto{key: []byte("01234567890123456789012345678901")}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncCrypto(crypto))
	input := model.SyncConfigInput{
		Provider: model.SyncProviderS3, Strategy: model.SyncStrategySmart, IntervalMinutes: 0,
		RetentionCount: 30, RetentionDays: 90, MasterKey: syncTestMasterKey,
		Gist: model.GistSyncConfigInput{Token: "gist-token"}, WebDAV: model.WebDAVSyncConfigInput{URL: "https://dav.example", Password: "dav-password"},
		S3: model.S3SyncConfigInput{Region: "us-east-1", Bucket: "bucket", AccessKeyID: "access", SecretKey: "s3-secret"},
	}
	_, err := service.SaveConfig(input)
	require.NoError(t, err)
	config, err := service.LoadConfig()
	require.NoError(t, err)
	assert.True(t, config.MasterKeySaved)
	assert.True(t, config.Gist.TokenSaved)
	assert.True(t, config.WebDAV.PasswordSaved)
	assert.True(t, config.S3.SecretKeySaved)
	secrets, err := service.providerSecrets(config, nil)
	require.NoError(t, err)
	assert.Equal(t, "s3-secret", secrets.S3SecretKey)

	input.Gist, input.WebDAV.ClearPassword, input.S3.ClearSecretKey = model.GistSyncConfigInput{ClearToken: true}, true, true
	_, err = service.SaveConfig(input)
	require.NoError(t, err)
	config, err = service.LoadConfig()
	require.NoError(t, err)
	assert.False(t, config.Gist.TokenSaved)
	assert.False(t, config.WebDAV.PasswordSaved)
	assert.False(t, config.S3.SecretKeySaved)
}

func TestSyncConfigSaveRollsBackSecretsWhenConfigWriteFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	crypto := syncTestCrypto{key: []byte("01234567890123456789012345678901")}
	service := newTestSyncService(db, syncTestMasterKey, WithSyncCrypto(crypto))
	input := syncTestConfigInput()
	input.Gist.Token = "old-token"
	_, err := service.SaveConfig(input)
	require.NoError(t, err)
	require.NoError(t, installSyncConfigFailureTrigger(db))

	input.Gist.Token = "new-token"
	input.Gist.GistID = "new-gist"
	_, err = service.SaveConfig(input)
	require.ErrorContains(t, err, "forced config failure")
	secret, err := service.loadSecret(syncGistTokenSetting)
	require.NoError(t, err)
	assert.Equal(t, "old-token", secret)
	config, err := service.LoadConfig()
	require.NoError(t, err)
	assert.NotEqual(t, "new-gist", config.Gist.GistID)
}

func TestSyncConfigInvalidatesConflictWhenProviderTargetChanges(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*model.SyncConfigInput)
	}{
		{name: "provider", mutate: func(input *model.SyncConfigInput) {
			input.Provider = model.SyncProviderGist
			input.Gist.GistID = "gist-next"
		}},
		{name: "endpoint", mutate: func(input *model.SyncConfigInput) {
			input.WebDAV.URL = "https://dav.example/next"
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
			input := syncTestConfigInput()
			_, err := service.SaveConfig(input)
			require.NoError(t, err)
			conflict, content := installSyncConflict(service)
			test.mutate(&input)
			dashboard, err := service.SaveConfig(input)
			require.NoError(t, err)
			assert.Nil(t, dashboard.Conflict)
			assert.Nil(t, dashboard.RemoteVersion)
			assert.Equal(t, model.SyncStatePending, dashboard.State)
			assert.Empty(t, conflict.RemoteContent)
			assert.Equal(t, make([]byte, len(content)), content)
		})
	}
}

func TestSyncConfigKeepsConflictWhenProviderTargetIsUnchanged(t *testing.T) {
	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	input := syncTestConfigInput()
	_, err := service.SaveConfig(input)
	require.NoError(t, err)
	conflict, _ := installSyncConflict(service)
	input.RetentionCount++
	dashboard, err := service.SaveConfig(input)
	require.NoError(t, err)
	require.NotNil(t, dashboard.Conflict)
	assert.Equal(t, conflict.Summary, *dashboard.Conflict)
}

func installSyncConflict(service *SyncService) (*syncConflictState, []byte) {
	content := []byte("encrypted-conflict")
	conflict := &syncConflictState{Summary: model.SyncConflict{}, RemoteContent: content}
	service.setRuntimeState(syncRuntimeState{
		State: model.SyncStateConflict, Conflict: conflict,
		Remote: &model.SyncRemoteVersion{VersionID: "remote-version"},
	})
	return conflict, content
}

func installSyncConfigFailureTrigger(db *sql.DB) error {
	_, err := db.Exec(`CREATE TRIGGER fail_sync_config BEFORE INSERT ON settings
		WHEN NEW.key = 'sync.config' BEGIN SELECT RAISE(FAIL, 'forced config failure'); END`)
	return err
}

func TestProviderFactoryCreatesConfiguredProviders(t *testing.T) {
	config := defaultSyncConfig()
	secrets := syncProviderSecrets{GistToken: "token", WebDAVPassword: "password", S3SecretKey: "secret"}
	config.Gist.GistID = "gist"
	provider, err := (defaultSyncProviderFactory{}).Create(t.Context(), config, secrets)
	require.NoError(t, err)
	assert.IsType(t, &gistSyncProvider{}, provider)
	config.Provider, config.WebDAV.URL = model.SyncProviderWebDAV, "https://dav.example/backups"
	provider, err = (defaultSyncProviderFactory{}).Create(t.Context(), config, secrets)
	require.NoError(t, err)
	assert.IsType(t, &webDAVSyncProvider{}, provider)
	config.Provider, config.S3 = model.SyncProviderS3, model.S3SyncConfig{Region: "us-east-1", Bucket: "bucket", AccessKeyID: "access"}
	provider, err = (defaultSyncProviderFactory{}).Create(t.Context(), config, secrets)
	require.NoError(t, err)
	assert.IsType(t, &s3SyncProvider{}, provider)
	config.Provider = "unknown"
	_, err = (defaultSyncProviderFactory{}).Create(t.Context(), config, secrets)
	assert.ErrorContains(t, err, "unsupported")
}
