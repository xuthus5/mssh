package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSyncApplyRetentionDeletesOldVersions(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(dir),
		WithSyncSecretSource(func() (string, error) { return "secret-from-vault-xx", nil }),
	)
	require.NoError(t, svc.ensureVersionDirectory())
	versionDir := filepath.Join(dir, "sync", "versions")
	for i := 1; i <= 5; i++ {
		name := fmt.Sprintf("v%d.msshbackup", i)
		require.NoError(t, os.WriteFile(filepath.Join(versionDir, name), []byte("x"), 0o600))
		_, err := store.InsertSyncVersion(db, model.SyncVersion{
			VersionID: "id-" + name, VersionNumber: int64(i), SnapshotFingerprint: "fp-" + name,
			Provider: model.SyncProviderGist, Source: "local", FileName: name, SizeBytes: 1,
			CreatedAt: time.Now().UTC().AddDate(0, 0, -i),
		})
		require.NoError(t, err)
	}
	require.NoError(t, svc.applyRetention(model.SyncConfig{
		RetentionCount: 2, RetentionDays: 2, Provider: model.SyncProviderGist, Strategy: model.SyncStrategySmart,
	}))
	versions, err := store.ListSyncVersions(db, 20)
	require.NoError(t, err)
	assert.LessOrEqual(t, len(versions), 2)
}

func TestAssetCatalogEnvironmentAndProjectCRUD(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewAssetCatalogService(db, testutil.NewTestLogger())
	env, err := svc.CreateEnvironment(model.AssetEnvironmentInput{Name: "prod", ColorToken: model.AssetColorRed, SortOrder: 1})
	require.NoError(t, err)
	require.NoError(t, svc.UpdateEnvironment(model.AssetEnvironmentInput{ID: env.ID, Name: "production", ColorToken: model.AssetColorBlue, SortOrder: 2}))
	project, err := svc.CreateProject(model.AssetProjectInput{Name: "core", Code: "C1", Description: "d"})
	require.NoError(t, err)
	require.NoError(t, svc.UpdateProject(model.AssetProjectInput{ID: project.ID, Name: "core2", Code: "C2", Description: "d2"}))
	envs, err := svc.ListEnvironments()
	require.NoError(t, err)
	assert.NotEmpty(t, envs)
	projects, err := svc.ListProjects()
	require.NoError(t, err)
	assert.NotEmpty(t, projects)
}

func TestKeyServiceGenerateVariants(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 2)
	}
	runtime.SetDEK(dek)
	svc := NewKeyService(db, runtime, testutil.NewTestLogger())
	ed, err := svc.Generate("ed", model.KeyTypeED25519, 0)
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeED25519, ed.Type)
	ec, err := svc.Generate("ec", model.KeyTypeECDSA, 0)
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeECDSA, ec.Type)
	rsaKey, err := svc.Generate("rsa", model.KeyTypeRSA, 2048)
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeRSA, rsaKey.Type)
}

func TestSessionBulkDeleteImpactAndDelete(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 4)
	}
	runtime.SetDEK(dek)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), runtime, testutil.NewTestLogger())
	var ids []int64
	for i := 0; i < 3; i++ {
		created, err := svc.CreateSession(model.SessionInputFrom(model.Session{
			Name: fmt.Sprintf("bulk-%d", i), Host: "1.1.1.1", Port: 22, Username: "u",
			AuthMethod: model.AuthPassword, Password: "pw", KeepAlive: 30, TermType: "xterm",
		}))
		require.NoError(t, err)
		ids = append(ids, created.ID)
	}
	impact, err := svc.SessionsDeleteImpact(ids)
	require.NoError(t, err)
	assert.NotNil(t, impact)
	deleted, err := svc.DeleteSessions(ids)
	require.NoError(t, err)
	assert.Equal(t, 3, deleted)
}

func TestSettingLogSettingsPartialUpdate(t *testing.T) {
	db := testutil.NewTestDB(t)
	log := &stubLogConfigurer{dir: "/tmp/old", retention: 10}
	svc := NewSettingService(db, testutil.NewTestLogger(), log)

	require.NoError(t, svc.Set(model.SettingInputFrom(model.Setting{
		Key: "application.log_retention_days", Namespace: "application", Value: "21", ValueType: "number", Version: 1,
	})))
	assert.Equal(t, 21, log.retention)

	dir := t.TempDir()
	payload, err := json.Marshal(dir)
	require.NoError(t, err)
	require.NoError(t, svc.Set(model.SettingInputFrom(model.Setting{
		Key: "application.log_dir", Namespace: "application", Value: string(payload), ValueType: "string", Version: 1,
	})))
	assert.Equal(t, dir, log.dir)
	assert.Equal(t, 21, log.retention)
}

func TestTerminalOpenPoolEvictionPath(t *testing.T) {
	svc := NewTerminalService(nil, newMockEventBus(), 1, testutil.NewTestLogger())
	require.NoError(t, svc.SetMaxSize(3))
	assert.Equal(t, 0, svc.Count())
}
