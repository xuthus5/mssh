package service

import (
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAssetCatalogInvalidIDsAndColors(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewAssetCatalogService(db, testutil.NewTestLogger())
	assert.Error(t, svc.UpdateEnvironment(model.AssetEnvironmentInput{ID: 0, Name: "x", ColorToken: model.AssetColorRed}))
	assert.Error(t, svc.UpdateEnvironment(model.AssetEnvironmentInput{ID: 999, Name: "x", ColorToken: model.AssetColorRed}))
	assert.Error(t, svc.UpdateProject(model.AssetProjectInput{ID: 0, Name: "x", Code: "C"}))
	assert.Error(t, svc.UpdateProject(model.AssetProjectInput{ID: 999, Name: "x", Code: "C"}))
	assert.Error(t, svc.UpdateTag(model.AssetTagInput{ID: 0, Name: "x", ColorToken: model.AssetColorBlue}))
	assert.Error(t, svc.UpdateTag(model.AssetTagInput{ID: 999, Name: "x", ColorToken: model.AssetColorBlue}))
	_, err := svc.CreateEnvironment(model.AssetEnvironmentInput{Name: "bad", ColorToken: "nope"})
	assert.Error(t, err)
	_, err = svc.CreateTag(model.AssetTagInput{Name: " ", ColorToken: model.AssetColorBlue})
	assert.Error(t, err)
	_, err = svc.CreateProject(model.AssetProjectInput{Name: "", Code: "C1"})
	assert.Error(t, err)
}

func TestAssetCatalogDeleteAndBulkPaths(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewAssetCatalogService(db, testutil.NewTestLogger())
	env1, err := svc.CreateEnvironment(model.AssetEnvironmentInput{Name: "e1", ColorToken: model.AssetColorRed, SortOrder: 1})
	require.NoError(t, err)
	env2, err := svc.CreateEnvironment(model.AssetEnvironmentInput{Name: "e2", ColorToken: model.AssetColorBlue, SortOrder: 2})
	require.NoError(t, err)
	project1, err := svc.CreateProject(model.AssetProjectInput{Name: "p1", Code: "P1"})
	require.NoError(t, err)
	project2, err := svc.CreateProject(model.AssetProjectInput{Name: "p2", Code: "P2"})
	require.NoError(t, err)
	tag, err := svc.CreateTag(model.AssetTagInput{Name: "t1", ColorToken: model.AssetColorGreen})
	require.NoError(t, err)

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess, err := sessionSvc.CreateSession(model.SessionInput{
		Name: "s1", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent,
		EnvironmentID: &env1.ID, ProjectID: &project1.ID, TagIDs: []int64{tag.ID},
	})
	require.NoError(t, err)

	impact, err := svc.EnvironmentDeleteImpact(env1.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, impact.SessionCount)
	_, err = svc.ProjectDeleteImpact(project1.ID)
	require.NoError(t, err)
	_, err = svc.TagDeleteImpact(tag.ID)
	require.NoError(t, err)

	require.NoError(t, svc.DeleteEnvironment(model.AssetDeleteInput{ID: env1.ID, Mode: "migrate", ReplacementID: &env2.ID}))
	require.NoError(t, svc.DeleteProject(model.AssetDeleteInput{ID: project1.ID, Mode: "clear"}))
	require.NoError(t, svc.DeleteTag(tag.ID))

	n, err := svc.BulkSetEnvironment(model.BulkAssetAssignmentInput{SessionIDs: []int64{sess.ID}, TargetID: &env2.ID})
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	n, err = svc.BulkSetProject(model.BulkAssetAssignmentInput{SessionIDs: []int64{sess.ID}, TargetID: &project2.ID})
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	tag2, err := svc.CreateTag(model.AssetTagInput{Name: "t2", ColorToken: model.AssetColorPink})
	require.NoError(t, err)
	n, err = svc.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: []int64{sess.ID}, TagIDs: []int64{tag2.ID}, Operation: "replace"})
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	require.NoError(t, svc.ReorderEnvironments([]int64{env2.ID}))
	require.NoError(t, svc.ReorderProjects([]int64{project2.ID}))
	assert.Error(t, svc.DeleteEnvironment(model.AssetDeleteInput{ID: env2.ID, Mode: "migrate"}))
	_, err = svc.BulkUpdateTags(model.BulkTagUpdateInput{SessionIDs: []int64{sess.ID}, Operation: "nope"})
	assert.Error(t, err)
}

func TestKeyGenerateUnsupportedAndRequireCrypto(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, nil, testutil.NewTestLogger())
	_, err := svc.Generate("x", model.KeyType("unknown"), 0)
	assert.Error(t, err)
	_, err = svc.Generate("x", model.KeyTypeED25519, 0)
	assert.Error(t, err)

	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 7)
	}
	runtime.SetDEK(dek)
	svc = NewKeyService(db, runtime, testutil.NewTestLogger())
	_, err = svc.Generate("", model.KeyTypeED25519, 0)
	assert.Error(t, err)
}

func TestSessionCRUDValidationErrors(t *testing.T) {
	db := testutil.NewTestDB(t)
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i + 1)
	}
	runtime.SetDEK(dek)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), runtime, testutil.NewTestLogger())
	badEnv := int64(99999)
	_, err := svc.CreateSession(model.SessionInput{
		Name: "bad-env", Host: "1.1.1.1", Port: 22, Username: "u", AuthMethod: model.AuthPassword, Password: "p",
		KeepAlive: 30, TermType: "xterm", EnvironmentID: &badEnv,
	})
	assert.Error(t, err)
	created, err := svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "ok", Host: "1.1.1.1", Port: 22, Username: "u", AuthMethod: model.AuthPassword, Password: "p", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	assert.Error(t, svc.UpdateSession(model.SessionInput{
		ID: created.ID, Name: "ok", Host: "1.1.1.1", Port: 22, Username: "u", AuthMethod: model.AuthPassword,
		KeepAlive: 30, TermType: "xterm", EnvironmentID: &badEnv,
	}))
	assert.Error(t, svc.DeleteSession(999999))
	_, err = svc.DeleteSessions(nil)
	assert.Error(t, err)
	_, err = svc.SessionsDeleteImpact(nil)
	assert.Error(t, err)
	_, err = svc.DeleteSessions([]int64{created.ID, 999999})
	assert.Error(t, err)
}

func TestAgentAuthCloseClosesSocket(t *testing.T) {
	c1, c2 := net.Pipe()
	t.Cleanup(func() { _ = c2.Close() })
	auth := &agentAuth{sock: c1}
	auth.Close()
	auth.Close() // second close safe
}

func TestSyncExportWithVaultAndFailingVaultSource(t *testing.T) {
	db := testutil.NewTestDB(t)
	vault, _, err := crypto.CreateVault("initial-pass-12")
	require.NoError(t, err)
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()),
		WithSyncSecretSource(func() (string, error) { return "secret-from-vault-xx", nil }),
		WithVaultSource(func() (*crypto.VaultFile, error) { return &vault, nil }),
	)
	path := t.TempDir() + "/export.msshbackup"
	require.NoError(t, svc.Export(path))

	failing := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()),
		WithSyncSecretSource(func() (string, error) { return "secret-from-vault-xx", nil }),
		WithVaultSource(func() (*crypto.VaultFile, error) { return nil, assert.AnError }),
	)
	assert.Error(t, failing.Export(t.TempDir()+"/x.msshbackup"))
}

func TestSyncHistoryDeleteFileErrorIgnoredForMissing(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()),
		WithSyncSecretSource(func() (string, error) { return "secret-from-vault-xx", nil }),
	)
	require.NoError(t, svc.ensureVersionDirectory())
	version, err := store.InsertSyncVersion(db, model.SyncVersion{
		VersionID: "nofile", VersionNumber: 3, SnapshotFingerprint: "fp-nofile",
		Provider: model.SyncProviderGist, Source: "local", FileName: "does-not-exist.msshbackup", SizeBytes: 1,
		CreatedAt: time.Now().UTC(),
	})
	require.NoError(t, err)
	require.NoError(t, svc.DeleteVersion(version.ID))
}

func TestStoreSessionErrorPathsViaService(t *testing.T) {
	db := testutil.NewTestDB(t)
	// closed DB list/create
	require.NoError(t, db.Close())
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	_, err := svc.ListSessions(nil)
	assert.Error(t, err)
	_, err = svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "x", Host: "1.1.1.1", Port: 22, Username: "u", AuthMethod: model.AuthAgent, KeepAlive: 30, TermType: "xterm",
	}))
	assert.Error(t, err)
}
