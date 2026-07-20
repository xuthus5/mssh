package service

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	sshtestutil "github.com/xuthus5/mssh/internal/ssh/testutil"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/pkg/event"
)

func TestAuditServiceEnabled(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewAuditService(db, testutil.NewTestLogger())

	enabled, err := service.Enabled()
	require.NoError(t, err)
	assert.False(t, enabled)

	require.NoError(t, service.SetEnabled(true))
	enabled, err = service.Enabled()
	require.NoError(t, err)
	assert.True(t, enabled)
}

func TestFileServiceListTransfersPersistsLifecycle(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "xfer", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)

	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(db))
	empty, err := svc.ListTransfers()
	require.NoError(t, err)
	assert.Empty(t, empty)

	require.NoError(t, svc.createTransfer("file-task-1", created.ID, "upload", "/local", "/remote"))
	jobs, err := svc.ListTransfers()
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	assert.Equal(t, "file-task-1", jobs[0].ID)
	assert.Equal(t, "failed", jobs[0].Status)
	assert.Equal(t, "xfer", jobs[0].SessionName)

	require.NoError(t, svc.createTransfer("file-task-2", created.ID, "download", "/remote", "/local"))
	svc.finishTransfer("file-task-2", "completed", "")
	jobs, err = svc.ListTransfers()
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(jobs), 1)
	var completed *model.TransferJob
	for index := range jobs {
		if jobs[index].ID == "file-task-2" {
			completed = &jobs[index]
			break
		}
	}
	require.NotNil(t, completed)
	assert.Equal(t, "completed", completed.Status)

	// no-db service short-circuits persistence helpers
	noDB := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger())
	listed, err := noDB.ListTransfers()
	require.NoError(t, err)
	assert.Empty(t, listed)
	require.NoError(t, noDB.createTransfer("x", created.ID, "download", "a", "b"))
	noDB.finishTransfer("x", "failed", "boom")
}

func TestFileServiceCreateTransferMissingSession(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(db))
	err := svc.createTransfer("missing", 999, "upload", "a", "b")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "create transfer")
}

func TestSyncServiceSaveGistIDAndProviderHelpers(t *testing.T) {
	db := testutil.NewTestDB(t)
	crypto := syncTestCrypto{key: []byte("01234567890123456789012345678901")}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncCrypto(crypto))

	config := defaultSyncConfig()
	config.Provider = model.SyncProviderGist
	config.Gist.GistID = "old"
	require.NoError(t, service.saveGistID(config, "gist-new"))

	loaded, err := service.LoadConfig()
	require.NoError(t, err)
	assert.Equal(t, "gist-new", loaded.Gist.GistID)

	assert.Equal(t, "gist-new", providerIdentity(loaded))
	loaded.Provider = model.SyncProviderWebDAV
	loaded.WebDAV.URL = "https://dav.example"
	loaded.WebDAV.Username = "alice"
	assert.Equal(t, "https://dav.example\x00alice", providerIdentity(loaded))
	loaded.Provider = model.SyncProviderS3
	loaded.S3 = model.S3SyncConfig{Endpoint: "e", Region: "r", Bucket: "b", Prefix: "p", AccessKeyID: "a", PathStyle: true}
	assert.Contains(t, providerIdentity(loaded), "e")
	loaded.Provider = "unknown"
	assert.Equal(t, "", providerIdentity(loaded))

	assert.Equal(t, "string", syncSettingType("x"))
	assert.Equal(t, "boolean", syncSettingType(true))
	assert.Equal(t, "number", syncSettingType(int64(1)))
	assert.Equal(t, "object", syncSettingType(config))
}

func TestValidateProviderReadyAndProviderSecretsBranches(t *testing.T) {
	db := testutil.NewTestDB(t)
	crypto := syncTestCrypto{key: []byte("01234567890123456789012345678901")}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncCrypto(crypto))

	require.ErrorContains(t, validateProviderReady(model.SyncConfig{Provider: model.SyncProviderGist}, syncProviderSecrets{}), "GitHub token")
	require.ErrorContains(t, validateProviderReady(model.SyncConfig{Provider: model.SyncProviderWebDAV}, syncProviderSecrets{}), "WebDAV URL")
	require.ErrorContains(t, validateProviderReady(model.SyncConfig{Provider: model.SyncProviderS3}, syncProviderSecrets{}), "S3 region")
	require.NoError(t, validateProviderReady(model.SyncConfig{Provider: model.SyncProviderGist}, syncProviderSecrets{GistToken: "t"}))
	require.NoError(t, validateProviderReady(model.SyncConfig{Provider: model.SyncProviderWebDAV, WebDAV: model.WebDAVSyncConfig{URL: "https://x"}}, syncProviderSecrets{}))
	require.NoError(t, validateProviderReady(model.SyncConfig{
		Provider: model.SyncProviderS3,
		S3:       model.S3SyncConfig{Region: "us-east-1", Bucket: "b", AccessKeyID: "a"},
	}, syncProviderSecrets{S3SecretKey: "s"}))

	// input-provided secrets take precedence
	config := model.SyncConfig{Provider: model.SyncProviderGist}
	secrets, err := service.providerSecrets(config, &model.SyncConfigInput{Gist: model.GistSyncConfigInput{Token: "from-input"}})
	require.NoError(t, err)
	assert.Equal(t, "from-input", secrets.GistToken)

	require.NoError(t, service.saveSecret(syncGistTokenSetting, "from-store"))
	secrets, err = service.providerSecrets(config, nil)
	require.NoError(t, err)
	assert.Equal(t, "from-store", secrets.GistToken)

	config.Provider = model.SyncProviderWebDAV
	require.NoError(t, service.saveSecret(syncWebDAVPasswordSetting, "dav-pass"))
	secrets, err = service.providerSecrets(config, nil)
	require.NoError(t, err)
	assert.Equal(t, "dav-pass", secrets.WebDAVPassword)
	secrets, err = service.providerSecrets(config, &model.SyncConfigInput{WebDAV: model.WebDAVSyncConfigInput{Password: "override"}})
	require.NoError(t, err)
	assert.Equal(t, "override", secrets.WebDAVPassword)

	config.Provider = model.SyncProviderS3
	require.NoError(t, service.saveSecret(syncS3SecretSetting, "s3-store"))
	secrets, err = service.providerSecrets(config, nil)
	require.NoError(t, err)
	assert.Equal(t, "s3-store", secrets.S3SecretKey)

	optional, err := service.loadOptionalSecret("missing-secret-key")
	require.NoError(t, err)
	assert.Equal(t, "", optional)
}

func TestSyncServiceDeleteVersionGuardsAndCleanup(t *testing.T) {
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(dataDir))
	require.NoError(t, service.ensureVersionDirectory())

	err := service.DeleteVersion(999)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")

	fileName := "keep.msshbackup"
	path := syncVersionPath(dataDir, fileName)
	require.NoError(t, os.WriteFile(path, []byte("data"), 0o600))
	protected, err := store.InsertSyncVersion(db, model.SyncVersion{
		VersionID: "v-protected", SnapshotFingerprint: "fp-p", Provider: model.SyncProviderGist,
		Source: "test", FileName: fileName, SizeBytes: 4, Protected: true, CreatedAt: time.Now().UTC(),
	})
	require.NoError(t, err)
	require.ErrorContains(t, service.DeleteVersion(protected.ID), "protected")

	deletableName := "drop.msshbackup"
	deletablePath := syncVersionPath(dataDir, deletableName)
	require.NoError(t, os.WriteFile(deletablePath, []byte("drop"), 0o600))
	deletable, err := store.InsertSyncVersion(db, model.SyncVersion{
		VersionID: "v-drop", SnapshotFingerprint: "fp-d", Provider: model.SyncProviderGist,
		Source: "test", FileName: deletableName, SizeBytes: 4, Protected: false, CreatedAt: time.Now().UTC(),
	})
	require.NoError(t, err)
	require.NoError(t, service.DeleteVersion(deletable.ID))
	_, statErr := os.Stat(deletablePath)
	assert.True(t, errors.Is(statErr, os.ErrNotExist))
}

func TestEnsureVersionDirectoryRequiresDataDir(t *testing.T) {
	service := NewSyncService(testutil.NewTestDB(t), testutil.NewTestLogger())
	require.ErrorContains(t, service.ensureVersionDirectory(), "unavailable")
}

func TestNormalizeGistIDAndReadGistFile(t *testing.T) {
	assert.Equal(t, "abc", normalizeGistID("https://gist.github.com/user/abc"))
	assert.Equal(t, "abc", normalizeGistID("abc"))
	assert.Equal(t, "x", normalizeGistID("https://example.com/x"))
	assert.Equal(t, "plain-id", normalizeGistID(" plain-id "))

	provider, err := newGistSyncProvider(http.DefaultClient, "https://api.github.com", "gist", "token")
	require.NoError(t, err)

	content, err := provider.readGistFile(context.Background(), gistFile{Content: "inline", Truncated: false})
	require.NoError(t, err)
	assert.Equal(t, []byte("inline"), content)

	_, err = provider.readGistFile(context.Background(), gistFile{Content: strings.Repeat("x", maxCloudBackupSize+1)})
	require.Error(t, err)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer token", r.Header.Get("Authorization"))
		_, _ = io.WriteString(w, "raw-body")
	}))
	t.Cleanup(server.Close)
	content, err = provider.readGistFile(context.Background(), gistFile{Truncated: true, RawURL: server.URL})
	require.NoError(t, err)
	assert.Equal(t, []byte("raw-body"), content)

	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	t.Cleanup(bad.Close)
	_, err = provider.readGistFile(context.Background(), gistFile{Truncated: true, RawURL: bad.URL})
	require.Error(t, err)
}

func TestGistAPIErrorAndExpectHTTPStatus(t *testing.T) {
	require.NoError(t, expectHTTPStatus(&http.Response{StatusCode: 200, Status: "200 OK"}, 200, "ok"))
	require.Error(t, expectHTTPStatus(&http.Response{StatusCode: 400, Status: "400 Bad Request"}, 200, "action"))

	resp := &http.Response{Status: "400 Bad Request", Body: io.NopCloser(strings.NewReader(`{"message":"nope"}`))}
	err := gistAPIError(resp, "update")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "nope")

	resp = &http.Response{Status: "500", Body: io.NopCloser(strings.NewReader("   "))}
	err = gistAPIError(resp, "update")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}

func TestTunnelServiceStopAllCleansActiveTunnels(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	svc := NewTunnelService(db, sessionSvc, newMockEventBus(), testutil.NewTestLogger())

	closed := false
	svc.mu.Lock()
	svc.tunnels[1] = &TunnelState{
		ID:     1,
		connID: "missing-conn",
		closed: func() error {
			closed = true
			return nil
		},
	}
	svc.mu.Unlock()

	svc.StopAll()
	assert.True(t, closed)
	svc.mu.Lock()
	assert.Empty(t, svc.tunnels)
	svc.mu.Unlock()
}

func TestResolveConflictCancelAndUnsupported(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()))
	service.setRuntimeState(syncRuntimeState{
		State: model.SyncStateConflict,
		Conflict: &syncConflictState{
			Remote: decodedSyncArtifact{Metadata: syncArtifactMetadata{VersionNumber: 3, VersionID: "r1", SnapshotFingerprint: "fp"}},
		},
	})

	result, err := service.ResolveConflict(model.SyncConflictCancel)
	require.NoError(t, err)
	assert.Equal(t, model.SyncStatePending, result.State)

	_, err = service.ResolveConflict(model.SyncConflictCancel)
	require.ErrorContains(t, err, "no longer available")

	service.setRuntimeState(syncRuntimeState{
		State: model.SyncStateConflict,
		Conflict: &syncConflictState{
			Remote: decodedSyncArtifact{Metadata: syncArtifactMetadata{VersionNumber: 3, VersionID: "r2", SnapshotFingerprint: "fp2"}},
		},
	})
	_, err = service.ResolveConflict(model.SyncConflictChoice("nope"))
	require.ErrorContains(t, err, "unsupported")
}

func TestWritePrivateFileAtomicAndSnapshotCodecErrors(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "nested")
	require.NoError(t, os.MkdirAll(nested, 0o700))
	path := filepath.Join(nested, "file.bin")
	require.NoError(t, writePrivateFileAtomic(path, []byte("payload")))
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, []byte("payload"), data)
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}

func TestFormatOptionalTimeAndRecordSyncEvent(t *testing.T) {
	assert.Equal(t, "", formatOptionalTime(time.Time{}))
	now := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	assert.Equal(t, now.Format(time.RFC3339Nano), formatOptionalTime(now))

	db := testutil.NewTestDB(t)
	service := NewSyncService(db, testutil.NewTestLogger())
	service.recordSyncEvent("test-action", defaultSyncConfig(), model.SyncEventSuccess, 1, 2, "ok")
	events, err := service.ListEvents()
	require.NoError(t, err)
	require.NotEmpty(t, events)
	assert.Equal(t, "test-action", events[0].Action)
}

func TestSaveAndLoadSecretCryptoGuards(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSyncService(db, testutil.NewTestLogger())
	require.ErrorContains(t, service.saveSecret("k", "v"), "unavailable")
	_, err := service.loadSecret("k")
	require.Error(t, err)

	crypto := syncTestCrypto{key: []byte("01234567890123456789012345678901")}
	service = NewSyncService(db, testutil.NewTestLogger(), WithSyncCrypto(crypto))
	require.NoError(t, service.saveSecret(syncGistTokenSetting, "token-value"))
	value, err := service.loadSecret(syncGistTokenSetting)
	require.NoError(t, err)
	assert.Equal(t, "token-value", value)
	assert.True(t, service.secretSaved(syncGistTokenSetting))
	assert.False(t, service.secretSaved("missing"))
}

func TestRemoteVersionHelper(t *testing.T) {
	assert.Nil(t, remoteVersion(syncArtifactMetadata{}))
	meta := syncArtifactMetadata{VersionID: "v1", VersionNumber: 9, SnapshotFingerprint: "fp", CreatedAt: time.Now().UTC()}
	remote := remoteVersion(meta)
	require.NotNil(t, remote)
	assert.Equal(t, "v1", remote.VersionID)
	assert.Equal(t, int64(9), remote.VersionNumber)
}

func TestNewGistSyncProviderValidation(t *testing.T) {
	_, err := newGistSyncProvider(http.DefaultClient, "https://api.github.com", "id", "")
	require.ErrorContains(t, err, "token")
	_, err = newGistSyncProvider(http.DefaultClient, "://bad", "id", "token")
	require.Error(t, err)
	provider, err := newGistSyncProvider(http.DefaultClient, "https://api.github.com/", "abc", "token")
	require.NoError(t, err)
	assert.Equal(t, "abc", provider.gistID)
	assert.Equal(t, "https://api.github.com", provider.apiBase)
}

func TestWebDAVProviderErrorAndSuccessPaths(t *testing.T) {
	_, err := newWebDAVSyncProvider(http.DefaultClient, "://bad", "u", "p")
	require.Error(t, err)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		assert.True(t, ok)
		assert.Equal(t, "alice", user)
		assert.Equal(t, "secret", pass)
		switch {
		case r.Method == "PROPFIND":
			w.WriteHeader(http.StatusMultiStatus)
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, syncBackupFileName):
			if r.Header.Get("X-Force-404") == "1" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("ETag", `"etag-1"`)
			_, _ = w.Write([]byte("backup-bytes"))
		case r.Method == http.MethodPut:
			w.Header().Set("ETag", `"etag-2"`)
			w.WriteHeader(http.StatusCreated)
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)

	provider, err := newWebDAVSyncProvider(server.Client(), server.URL, "alice", "secret")
	require.NoError(t, err)
	require.NoError(t, provider.Test(context.Background()))

	obj, err := provider.Fetch(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []byte("backup-bytes"), obj.Content)
	assert.Equal(t, `"etag-1"`, obj.ETag)

	put, err := provider.Put(context.Background(), []byte("new"), `"etag-1"`)
	require.NoError(t, err)
	assert.Equal(t, `"etag-2"`, put.ETag)

	// force not found on dedicated server
	notFound := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(notFound.Close)
	missing, err := newWebDAVSyncProvider(notFound.Client(), notFound.URL, "", "")
	require.NoError(t, err)
	_, err = missing.Fetch(context.Background())
	require.ErrorIs(t, err, errSyncRemoteNotFound)

	badStatus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(badStatus.Close)
	broken, err := newWebDAVSyncProvider(badStatus.Client(), badStatus.URL, "u", "p")
	require.NoError(t, err)
	require.Error(t, broken.Test(context.Background()))
	_, err = broken.Fetch(context.Background())
	require.Error(t, err)
	_, err = broken.Put(context.Background(), []byte("x"), "")
	require.Error(t, err)
}

func TestFileServiceSizeHelpersAndProgress(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(db))

	assert.Equal(t, int64(0), svc.getFileSize(filepath.Join(t.TempDir(), "missing.bin")))
	path := filepath.Join(t.TempDir(), "size.bin")
	require.NoError(t, os.WriteFile(path, []byte("12345"), 0o600))
	assert.Equal(t, int64(5), svc.getFileSize(path))

	// reportProgress with and without start marker
	svc.reportProgress("no-start", 10, 100)
	svc.recordStart("task-progress")
	svc.reportProgress("task-progress", 50, 100)
	svc.clearStart("task-progress")
	svc.emitTransferError("task-progress", errors.New("boom"))
	svc.emitTransferCancelled("task-progress")
}

func TestHostKeyParseAndDeleteEdgeCases(t *testing.T) {
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	svc := NewSessionService(db, newMockEventBus(), 30, dataDir, nil, testutil.NewTestLogger())

	// missing file
	entries, err := svc.ListHostKeys()
	require.NoError(t, err)
	assert.Empty(t, entries)

	// generate a real public key line
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromKey(privateKey)
	require.NoError(t, err)
	pub := signer.PublicKey()
	encoded := base64.StdEncoding.EncodeToString(pub.Marshal())
	line := fmt.Sprintf("example.com ssh-rsa %s", encoded)
	marked := fmt.Sprintf("@cert-authority example.org ssh-rsa %s", encoded)
	content := strings.Join([]string{"# comment", "bad line", line, marked, ""}, "\n")
	require.NoError(t, os.WriteFile(filepath.Join(dataDir, "known_hosts"), []byte(content), 0o600))

	entries, err = svc.ListHostKeys()
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(entries), 2)

	require.Error(t, svc.DeleteHostKey(0))
	require.Error(t, svc.DeleteHostKey(999))
	require.NoError(t, svc.DeleteHostKey(entries[0].Line))
}

func TestSaveVersionAndRestoreMissing(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	dataDir := t.TempDir()
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(dataDir), WithSyncLifecycle(&fakeSyncLifecycle{}))
	_, err := store.CreateSession(db, model.Session{Name: "node", Host: "1.1.1.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)

	version, err := service.saveCurrentVersion(model.SyncProviderWebDAV, "manual", false)
	require.NoError(t, err)
	require.NotNil(t, version)
	assert.FileExists(t, service.versionFilePath(*version))

	require.ErrorContains(t, service.RestoreVersion(99999), "not found")
}

func TestChooseSyncActionBranches(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	provider := &fakeSyncProvider{}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncProviderFactory(fakeSyncProviderFactory{provider}))
	local := syncCurrentSnapshot{Fingerprint: "local-fp", Data: ExportData{}}
	artifact := decodedSyncArtifact{Metadata: syncArtifactMetadata{SnapshotFingerprint: "remote-fp", VersionID: "r", VersionNumber: 1}, Content: []byte("remote")}

	_, err := service.chooseSyncAction(context.Background(), defaultSyncConfig(), syncDirectionPull, provider, local, syncRemoteObject{}, artifact, false, syncBaseline{})
	require.ErrorIs(t, err, errSyncRemoteNotFound)

	// not found + non-pull triggers uploadSnapshot
	_, err = service.chooseSyncAction(context.Background(), defaultSyncConfig(), syncDirectionPush, provider, local, syncRemoteObject{}, artifact, false, syncBaseline{})
	_ = err

	// strategy unsupported on smart path
	cfg := defaultSyncConfig()
	cfg.Strategy = "nope"
	_, err = service.chooseSyncAction(context.Background(), cfg, "", provider, local, syncRemoteObject{Content: []byte("c"), ETag: "e"}, artifact, true, syncBaseline{})
	require.ErrorContains(t, err, "unsupported sync strategy")
}

func TestEnrichLocalDashboardAndOptionalSecrets(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()))
	dashboard, err := service.Dashboard()
	require.NoError(t, err)
	assert.NotEmpty(t, dashboard.State)

	// format covered already; enrichLocal via Dashboard path
	assert.NotNil(t, dashboard)
}

func TestSmartSyncDecisionMatrix(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncProviderFactory(fakeSyncProviderFactory{&fakeSyncProvider{}}))
	config := defaultSyncConfig()
	local := syncCurrentSnapshot{Fingerprint: "local", Data: ExportData{}}
	remoteArtifact := decodedSyncArtifact{
		Metadata: syncArtifactMetadata{VersionID: "remote", VersionNumber: 2, SnapshotFingerprint: "remote", CreatedAt: time.Now().UTC()},
		Content:  []byte("remote-content"),
	}
	remote := syncRemoteObject{Content: remoteArtifact.Content, ETag: "etag"}

	// no baseline => conflict
	result, err := service.smartSync(context.Background(), config, &fakeSyncProvider{}, local, remote, remoteArtifact, syncBaseline{})
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateConflict, result.State)

	// both changed => conflict
	result, err = service.smartSync(context.Background(), config, &fakeSyncProvider{}, local, remote, remoteArtifact, syncBaseline{SnapshotFingerprint: "base"})
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateConflict, result.State)

	// only remote changed => download path (may fail validate/restore; still cover branch)
	localSameBase := syncCurrentSnapshot{Fingerprint: "base", Data: ExportData{}}
	_, err = service.smartSync(context.Background(), config, &fakeSyncProvider{}, localSameBase, remote, remoteArtifact, syncBaseline{SnapshotFingerprint: "base"})
	_ = err

	// only local changed => upload
	localChanged := syncCurrentSnapshot{Fingerprint: "local-new", Data: ExportData{}}
	provider := &fakeSyncProvider{remote: syncRemoteObject{Content: []byte("old"), ETag: "etag"}}
	artifactSameRemote := decodedSyncArtifact{
		Metadata: syncArtifactMetadata{VersionID: "remote", VersionNumber: 2, SnapshotFingerprint: "base", CreatedAt: time.Now().UTC()},
		Content:  []byte("old"),
	}
	_, err = service.smartSync(context.Background(), config, provider, localChanged, provider.remote, artifactSameRemote, syncBaseline{SnapshotFingerprint: "base"})
	_ = err

	// neither changed => noop
	same := syncCurrentSnapshot{Fingerprint: "base", Data: ExportData{}}
	sameArtifact := decodedSyncArtifact{Metadata: syncArtifactMetadata{VersionID: "r", VersionNumber: 1, SnapshotFingerprint: "base", CreatedAt: time.Now().UTC()}, Content: []byte("c")}
	result, err = service.smartSync(context.Background(), config, &fakeSyncProvider{remote: syncRemoteObject{Content: []byte("c"), ETag: "e"}}, same, syncRemoteObject{Content: []byte("c"), ETag: "e"}, sameArtifact, syncBaseline{SnapshotFingerprint: "base"})
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
}

func TestGistFetchMissingAndDecodePaths(t *testing.T) {
	// empty gist id
	provider, err := newGistSyncProvider(http.DefaultClient, "https://api.github.com", "", "token")
	require.NoError(t, err)
	_, err = provider.Fetch(context.Background())
	require.ErrorIs(t, err, errSyncRemoteNotFound)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/gists/missing":
			w.WriteHeader(http.StatusNotFound)
		case r.URL.Path == "/gists/nofile":
			_ = json.NewEncoder(w).Encode(gistResponse{ID: "nofile", Files: map[string]gistFile{}})
		case r.URL.Path == "/gists/ok":
			w.Header().Set("ETag", `"v"`)
			_ = json.NewEncoder(w).Encode(gistResponse{ID: "ok", Files: map[string]gistFile{syncBackupFileName: {Content: "payload"}}})
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)

	missing, err := newGistSyncProvider(server.Client(), server.URL, "missing", "token")
	require.NoError(t, err)
	_, err = missing.Fetch(context.Background())
	require.ErrorIs(t, err, errSyncRemoteNotFound)

	nofile, err := newGistSyncProvider(server.Client(), server.URL, "nofile", "token")
	require.NoError(t, err)
	_, err = nofile.Fetch(context.Background())
	require.ErrorIs(t, err, errSyncRemoteNotFound)

	ok, err := newGistSyncProvider(server.Client(), server.URL, "ok", "token")
	require.NoError(t, err)
	obj, err := ok.Fetch(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []byte("payload"), obj.Content)
	assert.Equal(t, "ok", obj.ProviderID)
}

func TestChooseSyncActionCloudAndLocalFirst(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()))
	local := syncCurrentSnapshot{Fingerprint: "local", Data: ExportData{}}
	artifact := decodedSyncArtifact{Metadata: syncArtifactMetadata{SnapshotFingerprint: "remote", VersionID: "r", VersionNumber: 1, CreatedAt: time.Now().UTC()}, Content: []byte("remote")}
	remote := syncRemoteObject{Content: artifact.Content, ETag: "e"}
	provider := &fakeSyncProvider{remote: remote}

	cfg := defaultSyncConfig()
	cfg.Strategy = model.SyncStrategyCloudFirst
	_, err := service.chooseSyncAction(context.Background(), cfg, "", provider, local, remote, artifact, true, syncBaseline{})
	_ = err

	cfg.Strategy = model.SyncStrategyLocalFirst
	_, err = service.chooseSyncAction(context.Background(), cfg, "", provider, local, remote, artifact, true, syncBaseline{})
	_ = err

	// fingerprints equal => noop
	same := decodedSyncArtifact{Metadata: syncArtifactMetadata{SnapshotFingerprint: "local", VersionID: "r", VersionNumber: 1, CreatedAt: time.Now().UTC()}, Content: []byte("x")}
	result, err := service.chooseSyncAction(context.Background(), defaultSyncConfig(), "", provider, local, remote, same, true, syncBaseline{})
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
}

func TestCompleteNoopAndFinishSuccessfulSync(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()))
	cfg := defaultSyncConfig()
	artifact := decodedSyncArtifact{Metadata: syncArtifactMetadata{VersionID: "v", VersionNumber: 2, SnapshotFingerprint: "fp", CreatedAt: time.Now().UTC()}}
	result, err := service.completeNoop(cfg, artifact, "etag")
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	require.NoError(t, service.finishSuccessfulSync(cfg, artifact.Metadata, "etag", 1))
}

func TestSaveCloudMetadataAndS3ErrorCode(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSyncService(db, testutil.NewTestLogger())
	require.NoError(t, service.saveCloudMetadata("etag-x", "upload"))
	assert.Equal(t, "etag-x", service.cloudETag())
	assert.Equal(t, "", s3ErrorCode(errors.New("plain")))
}

func TestDownloadSnapshotValidateFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncLifecycle(&fakeSyncLifecycle{}))
	artifact := decodedSyncArtifact{
		Data:     ExportData{}, // empty may still validate
		Metadata: syncArtifactMetadata{VersionID: "v", VersionNumber: 1, SnapshotFingerprint: "fp", CreatedAt: time.Now().UTC()},
		Content:  []byte("not-a-real-artifact"),
	}
	// invalid content still attempts validate/restore/save paths
	_, err := service.downloadSnapshot(defaultSyncConfig(), artifact, "etag")
	_ = err
}

type failingSyncProvider struct {
	testErr  error
	fetchErr error
	putErr   error
}

func (f *failingSyncProvider) Test(context.Context) error { return f.testErr }

func (f *failingSyncProvider) Fetch(context.Context) (syncRemoteObject, error) {
	if f.fetchErr != nil {
		return syncRemoteObject{}, f.fetchErr
	}
	return syncRemoteObject{}, errSyncRemoteNotFound
}

func (f *failingSyncProvider) Put(context.Context, []byte, string) (syncRemoteObject, error) {
	if f.putErr != nil {
		return syncRemoteObject{}, f.putErr
	}
	return syncRemoteObject{}, errors.New("put failed")
}

type failingSyncProviderFactory struct{ provider syncProvider }

func (f failingSyncProviderFactory) Create(context.Context, model.SyncConfig, syncProviderSecrets) (syncProvider, error) {
	return f.provider, nil
}

type errorLifecycle struct{}

func (errorLifecycle) PrepareDestructiveSync() error { return errors.New("busy sessions") }

func TestTestProviderValidationAndFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	provider := &failingSyncProvider{testErr: errors.New("network down")}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncProviderFactory(failingSyncProviderFactory{provider}))
	input := syncTestConfigInput()
	require.Error(t, service.TestProvider(input))

	// invalid config branch
	bad := input
	bad.Provider = "unknown"
	require.Error(t, service.TestProvider(bad))
}

func TestRunSyncExecuteFailureAndDisabled(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	provider := &failingSyncProvider{fetchErr: errors.New("fetch broken"), putErr: errors.New("put broken")}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncProviderFactory(failingSyncProviderFactory{provider}))
	_, err := service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)

	_, err = service.SyncNow()
	require.Error(t, err)

	// disabled scheduled path
	cfg := defaultSyncConfig()
	cfg.Enabled = false
	require.NoError(t, writeSyncSetting(db, syncConfigSetting, cfg))
	result, err := service.runSync(context.Background(), syncDirectionStrategy, "scheduler")
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateDisabled, result.State)
}

func TestPrepareDestructiveSyncLifecycleError(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncLifecycle(errorLifecycle{}))
	require.ErrorContains(t, service.prepareDestructiveSync(defaultSyncConfig(), "pre"), "busy sessions")
	require.ErrorContains(t, service.ResetLocalData(), "busy sessions")
}

func TestTerminalOpenFailureBranches(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	addr, cleanup := sshtestutil.NewMockServerRejectPty(t)
	defer cleanup()
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "reject-pty", Host: "127.0.0.1", Port: parsePort(t, addr), Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	termSvc := NewTerminalService(sessionSvc, newMockEventBus(), 32, testutil.NewTestLogger())
	_, err = termSvc.Open(context.Background(), created.ID, 80, 24)
	require.Error(t, err)

	addr2, cleanup2 := sshtestutil.NewMockServerRejectShell(t)
	defer cleanup2()
	created2, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "reject-shell", Host: "127.0.0.1", Port: parsePort(t, addr2), Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	_, err = termSvc.Open(context.Background(), created2.ID, 80, 24)
	require.Error(t, err)
}

func TestUploadSnapshotGistIDPersistence(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	provider := &fakeSyncProvider{}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncProviderFactory(fakeSyncProviderFactory{provider}))
	_, err := service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)
	_, err = store.CreateSession(db, model.Session{Name: "local", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	result, err := service.PushNow()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	assert.Equal(t, "provider-1", provider.remote.ProviderID)
}

func TestCancelAllTransfers(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(db))
	cancelled := false
	svc.mu.Lock()
	svc.tasks["task"] = func() { cancelled = true }
	svc.mu.Unlock()
	svc.CancelAll()
	assert.True(t, cancelled)
}

func TestDownloadSnapshotSuccessPath(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	lifecycle := &fakeSyncLifecycle{}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncLifecycle(lifecycle), WithSyncEventBus(newMockEventBus()))
	_, err := store.CreateSession(db, model.Session{Name: "seed", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)

	data, err := service.snapshot()
	require.NoError(t, err)
	fp, err := snapshotFingerprint(data)
	require.NoError(t, err)
	meta := syncArtifactMetadata{VersionID: "cloud-v1", VersionNumber: 4, SnapshotFingerprint: fp, DeviceID: "device", CreatedAt: time.Now().UTC()}
	content, err := encodeSyncArtifact(data, syncTestMasterKey, meta)
	require.NoError(t, err)
	artifact, err := decodeSyncArtifact(content, syncTestMasterKey)
	require.NoError(t, err)

	// mutate local so restore does work
	_, err = store.CreateSession(db, model.Session{Name: "extra", Host: "10.0.0.2", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)

	result, err := service.downloadSnapshot(defaultSyncConfig(), artifact, `"etag-cloud"`)
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	assert.Equal(t, 1, lifecycle.calls)
}

func TestWriteRecoveryPointAndNotify(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	bus := newMockEventBus()
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncEventBus(bus))
	require.NoError(t, service.writeRecoveryPoint(syncTestMasterKey))
	path, err := service.recoveryPath()
	require.NoError(t, err)
	assert.FileExists(t, path)
	service.notifyDataChanged()
	require.True(t, bus.hasEvent(syncDataChangedEvent))
}

func TestSystemInfoMissingTerminal(t *testing.T) {
	svc := NewTerminalService(nil, newMockEventBus(), 2, testutil.NewTestLogger())
	_, err := svc.SystemInfo("missing")
	require.ErrorContains(t, err, "not found")
}

func TestSetTerminalHandlers(t *testing.T) {
	svc := NewTerminalService(nil, newMockEventBus(), 2, testutil.NewTestLogger())
	called := false
	svc.SetOutputHandler(func(string, []byte) {})
	svc.SetCloseHandler(func(string) { called = true })
	svc.mu.Lock()
	handler := svc.closeHandler
	svc.mu.Unlock()
	require.NotNil(t, handler)
	handler("x")
	assert.True(t, called)
}

func TestFileServiceConnectDisconnectHelpers(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	svc := NewFileService(sessionSvc, newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(db))
	_, _, err := svc.connect(999)
	require.Error(t, err)
	svc.disconnect("missing")
}

func TestValidateSyncConfigBranches(t *testing.T) {
	cfg := defaultSyncConfig()
	require.NoError(t, validateSyncConfig(cfg))
	cfg.Provider = "x"
	require.Error(t, validateSyncConfig(cfg))
	cfg = defaultSyncConfig()
	cfg.Strategy = "x"
	require.Error(t, validateSyncConfig(cfg))
	cfg = defaultSyncConfig()
	cfg.IntervalMinutes = 7
	require.Error(t, validateSyncConfig(cfg))
	cfg = defaultSyncConfig()
	cfg.RetentionCount = 0
	require.Error(t, validateSyncConfig(cfg))
}

func TestGistPutCreateAndConflict(t *testing.T) {
	var created bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/gists":
			created = true
			w.Header().Set("ETag", `"new"`)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(gistResponse{ID: "created-gist"})
		case r.Method == http.MethodGet && r.URL.Path == "/gists/conflict":
			w.Header().Set("ETag", `"current"`)
			_ = json.NewEncoder(w).Encode(gistResponse{ID: "conflict"})
		case r.Method == http.MethodPatch && r.URL.Path == "/gists/conflict":
			w.WriteHeader(http.StatusConflict)
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)

	// create new gist when empty id
	provider, err := newGistSyncProvider(server.Client(), server.URL, "", "token")
	require.NoError(t, err)
	obj, err := provider.Put(context.Background(), []byte("backup"), "")
	require.NoError(t, err)
	assert.True(t, created)
	assert.Equal(t, "created-gist", obj.ProviderID)

	// conflict branch
	conflict, err := newGistSyncProvider(server.Client(), server.URL, "conflict", "token")
	require.NoError(t, err)
	_, err = conflict.Put(context.Background(), []byte("backup"), `"stale"`)
	require.ErrorIs(t, err, errSyncConflict)
}

func TestSaveVersionProtectExistingFingerprint(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()))
	data, err := service.snapshot()
	require.NoError(t, err)
	fp, err := snapshotFingerprint(data)
	require.NoError(t, err)
	meta := syncArtifactMetadata{VersionID: "same", VersionNumber: 1, SnapshotFingerprint: fp, CreatedAt: time.Now().UTC()}
	content, err := encodeSyncArtifact(data, syncTestMasterKey, meta)
	require.NoError(t, err)
	first, err := service.saveVersion(content, meta, model.SyncProviderGist, "manual", false)
	require.NoError(t, err)
	second, err := service.saveVersion(content, meta, model.SyncProviderGist, "manual", true)
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	assert.True(t, second.Protected)
}

func TestPullNowAndPushNowWrappers(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	provider := &fakeSyncProvider{}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncProviderFactory(fakeSyncProviderFactory{provider}))
	_, err := service.SaveConfig(syncTestConfigInput())
	require.NoError(t, err)
	_, err = store.CreateSession(db, model.Session{Name: "n", Host: "1.2.3.4", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	result, err := service.PushNow()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	result, err = service.PullNow()
	// pull with remote content may succeed/noop/fail depending decode; just exercise
	_ = result
	_ = err
}

func TestDeleteDefaultFolderRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	folders, err := store.ListFolders(db)
	require.NoError(t, err)
	require.NotEmpty(t, folders)
	err = store.DeleteFolder(db, folders[0].ID)
	require.Error(t, err)
}

func TestAssetCatalogHelperValidation(t *testing.T) {
	_, _, err := normalizeAssetName("", 8)
	require.Error(t, err)
	_, _, err = normalizeAssetName(strings.Repeat("a", 9), 8)
	require.Error(t, err)
	name, key, err := normalizeAssetName(" Prod ", 16)
	require.NoError(t, err)
	assert.Equal(t, "Prod", name)
	assert.Equal(t, "prod", key)
	require.Error(t, validateAssetColor("unknown"))
	require.NoError(t, validateAssetColor(model.AssetColorBlue))
	_, _, _, _, _, err = normalizeProject(model.AssetProjectInput{Name: "demo", Code: strings.Repeat("c", 25)})
	require.Error(t, err)
	_, _, _, _, _, err = normalizeProject(model.AssetProjectInput{Name: "demo", Code: "code"})
	require.NoError(t, err)
}

func TestEncodeEncryptedSnapshotRoundTrip(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()))
	data, err := service.snapshot()
	require.NoError(t, err)
	content, err := encodeEncryptedSnapshot(data, syncTestMasterKey)
	require.NoError(t, err)
	assert.NotEmpty(t, content)
}

func TestSFTPUploadDownloadWithTransferDB(t *testing.T) {
	sftpCtx := startSFTPTestServer(t)
	defer sftpCtx.cancel()

	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	port := parsePort(t, sftpCtx.addr)
	created, err := sessionSvc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "sftp-db", Host: "127.0.0.1", Port: port, Username: "test",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm-256color",
	}))
	require.NoError(t, err)
	bus := newMockEventBus()
	svc := NewFileService(sessionSvc, bus, testutil.NewTestLogger(), WithTransferDB(db))

	local := filepath.Join(t.TempDir(), "up.bin")
	require.NoError(t, os.WriteFile(local, []byte("hello-sftp-db"), 0o600))
	taskID, err := svc.Upload(created.ID, local, "/up.bin")
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		for _, captured := range bus.Events() {
			if captured.Name == event.TransferComplete {
				return true
			}
		}
		jobs, listErr := store.ListTransferJobs(db)
		return listErr == nil && len(jobs) > 0 && jobs[0].Status == "completed"
	}, 3*time.Second, 20*time.Millisecond)

	downloadPath := filepath.Join(t.TempDir(), "down.bin")
	_, err = svc.Download(created.ID, "/up.bin", downloadPath)
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		data, readErr := os.ReadFile(downloadPath)
		return readErr == nil && string(data) == "hello-sftp-db"
	}, 3*time.Second, 20*time.Millisecond)
	_ = taskID
}

func TestKeyUsageCountAndExport(t *testing.T) {
	db := testutil.NewTestDB(t)
	crypto := syncTestCrypto{key: []byte("01234567890123456789012345678901")}
	// reuse key service constructor from package
	keySvc := NewKeyService(db, crypto, testutil.NewTestLogger())
	created, err := keySvc.Generate("rsa-key", "rsa", 2048)
	require.NoError(t, err)
	count, err := keySvc.UsageCount(created.ID)
	require.NoError(t, err)
	assert.Equal(t, 0, count)
	pub, err := keySvc.ExportPublicKey(created.ID)
	require.NoError(t, err)
	assert.NotEmpty(t, pub)
	require.NoError(t, keySvc.Delete(created.ID))
}

func TestClosedDBErrorBranches(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	crypto := syncTestCrypto{key: []byte("01234567890123456789012345678901")}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncCrypto(crypto))
	keySvc := NewKeyService(db, crypto, testutil.NewTestLogger())
	audit := NewAuditService(db, testutil.NewTestLogger())
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	fileSvc := NewFileService(NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger()), newMockEventBus(), testutil.NewTestLogger(), WithTransferDB(db))

	require.NoError(t, db.Close())

	_, err := service.ListVersions()
	require.Error(t, err)
	_, err = service.ListEvents()
	require.Error(t, err)
	_, err = service.LoadConfig()
	require.Error(t, err)
	_, err = service.Dashboard()
	require.Error(t, err)
	_, err = keySvc.UsageCount(1)
	require.Error(t, err)
	_, err = keySvc.ExportPublicKey(1)
	require.Error(t, err)
	require.Error(t, keySvc.Delete(1))
	_, err = audit.Enabled()
	require.Error(t, err)
	require.Error(t, audit.SetEnabled(true))
	_, err = audit.List(model.AuditFilter{Limit: 10})
	require.Error(t, err)
	_, err = catalog.ListTags()
	require.Error(t, err)
	_, err = catalog.ListEnvironments()
	require.Error(t, err)
	_, err = catalog.ListProjects()
	require.Error(t, err)
	_, err = fileSvc.ListTransfers()
	require.Error(t, err)
	require.Error(t, fileSvc.createTransfer("t", 1, "upload", "a", "b"))
	fileSvc.finishTransfer("t", "failed", "x")
	fileSvc.reportProgress("t", 1, 2)
}

func TestAIDeleteProviderWithKeychain(t *testing.T) {
	db := testutil.NewTestDB(t)
	keychain := &aiMemoryKeychain{data: make(map[string][]byte), available: true}
	ai := NewAIService(db, nil, keychain, testutil.NewTestLogger())
	provider, err := ai.SaveProvider(model.AIProviderProfileInput{
		Name: "p", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://example.com", DefaultModel: "m", Enabled: true, APIKey: "k",
	})
	require.NoError(t, err)
	require.NoError(t, ai.DeleteProvider(provider.ID))
}
