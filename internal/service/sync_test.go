package service

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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

const syncTestMasterKey = "correct horse battery staple"

func TestSyncServiceExportImportRestoresEncryptedFullSnapshot(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetAuditEnabled(db, true))
	setSyncMasterKey(t, db, syncTestMasterKey)
	folder, err := store.CreateFolder(db, "生产环境", nil)
	require.NoError(t, err)
	catalog := NewAssetCatalogService(db, testutil.NewTestLogger())
	environment, err := catalog.CreateEnvironment(model.AssetEnvironmentInput{Name: "生产", ColorToken: model.AssetColorRed})
	require.NoError(t, err)
	project, err := catalog.CreateProject(model.AssetProjectInput{Name: "支付平台", Code: "PAY", Description: "核心支付"})
	require.NoError(t, err)
	tag, err := catalog.CreateTag(model.AssetTagInput{Name: "数据库", ColorToken: model.AssetColorBlue})
	require.NoError(t, err)
	created, err := store.CreateSessionWithTags(db, model.Session{FolderID: &folder.ID, Name: "s1", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, Password: "secret", KeepAlive: 30, TermType: "xterm", EnvironmentID: &environment.ID, ProjectID: &project.ID, Notes: "维护说明"}, []int64{tag.ID})
	require.NoError(t, err)
	_, err = store.CreateTunnel(db, model.Tunnel{SessionID: created.ID, Name: "web", Type: model.TunnelLocal, LocalHost: "127.0.0.1", LocalPort: 8080, RemoteHost: "127.0.0.1", RemotePort: 80})
	require.NoError(t, err)

	path := filepath.Join(t.TempDir(), "backup.msshbackup")
	require.NoError(t, NewSyncService(db, testutil.NewTestLogger()).Export(path))
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.NotContains(t, string(content), "secret")
	assert.NotContains(t, string(content), "生产环境")

	db2 := testutil.NewTestDB(t)
	setSyncMasterKey(t, db2, syncTestMasterKey)
	local, err := store.CreateSession(db2, model.Session{Name: "local-before-import", Host: "127.0.0.1", Port: 22, Username: "local", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	syncService := NewSyncService(db2, testutil.NewTestLogger())
	require.NoError(t, syncService.Import(path))
	recoveryPath, err := syncService.recoveryPath()
	require.NoError(t, err)
	recoveryContent, err := os.ReadFile(recoveryPath)
	require.NoError(t, err)
	var recoveryEnvelope backupcrypto.BackupEnvelope
	require.NoError(t, json.Unmarshal(recoveryContent, &recoveryEnvelope))
	recoveryPlaintext, err := backupcrypto.DecryptBackup(recoveryEnvelope, []byte(syncTestMasterKey))
	require.NoError(t, err)
	assert.Contains(t, string(recoveryPlaintext), local.Name)
	folders, err := store.ListFolders(db2)
	require.NoError(t, err)
	assert.Equal(t, "生产环境", folders[1].Name)
	assert.Equal(t, folder.ID, folders[1].ID)
	session, err := store.GetSession(db2, created.ID)
	require.NoError(t, err)
	assert.Equal(t, "secret", session.Password)
	require.NotNil(t, session.Environment)
	require.NotNil(t, session.Project)
	assert.Equal(t, "生产", session.Environment.Name)
	assert.Equal(t, "PAY", session.Project.Code)
	require.Len(t, session.Tags, 1)
	assert.Equal(t, "数据库", session.Tags[0].Name)
	assert.Equal(t, "维护说明", session.Notes)
	tunnels, err := store.ListTunnels(db2)
	require.NoError(t, err)
	assert.Len(t, tunnels, 1)
}

func TestSyncServiceStrictlyRejectsOldOrIncompleteFormats(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := NewSyncService(db, testutil.NewTestLogger()).snapshot()
	require.NoError(t, err)
	data.FormatVersion = syncFormatVersion - 1
	content, err := json.Marshal(data)
	require.NoError(t, err)
	var decoded ExportData
	assert.ErrorContains(t, decodeSnapshot(content, &decoded), "format_version")

	data.FormatVersion = syncFormatVersion
	delete(data.Tables, "session_tags")
	content, err = json.Marshal(data)
	require.NoError(t, err)
	assert.ErrorContains(t, decodeSnapshot(content, &decoded), "snapshot table session_tags is required")
}

func TestSyncSnapshotExcludesAIData(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := NewSyncService(db, testutil.NewTestLogger()).snapshot()
	require.NoError(t, err)
	for _, table := range []string{"ai_provider_profiles", "ai_settings", "ai_conversations", "ai_messages", "ai_command_executions"} {
		_, included := data.Tables[table]
		assert.False(t, included, "AI table %s must stay local", table)
	}
}

func TestSyncServiceRequiresMasterKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	path := filepath.Join(t.TempDir(), "backup.msshbackup")
	err := NewSyncService(db, testutil.NewTestLogger()).Export(path)
	assert.ErrorContains(t, err, "master key is not configured")
}

func TestSyncServiceImportRejectsWrongMasterKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetAuditEnabled(db, true))
	setSyncMasterKey(t, db, syncTestMasterKey)
	path := filepath.Join(t.TempDir(), "backup.msshbackup")
	require.NoError(t, NewSyncService(db, testutil.NewTestLogger()).Export(path))
	db2 := testutil.NewTestDB(t)
	setSyncMasterKey(t, db2, "another master key")
	err := NewSyncService(db2, testutil.NewTestLogger()).Import(path)
	assert.ErrorContains(t, err, "invalid master key")
}

func TestSyncServiceImportPreparesLifecycleAndNotifies(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	path := filepath.Join(t.TempDir(), "backup.msshbackup")
	require.NoError(t, NewSyncService(db, testutil.NewTestLogger()).Export(path))
	lifecycle := &fakeSyncLifecycle{}
	emitter := &fakeSyncEventBus{}
	service := NewSyncService(db, testutil.NewTestLogger(), WithSyncDataDir(t.TempDir()), WithSyncLifecycle(lifecycle), WithSyncEventBus(emitter))
	setSyncMasterKey(t, db, syncTestMasterKey)
	require.NoError(t, service.Import(path))
	assert.Equal(t, 1, lifecycle.calls)
	assert.Equal(t, syncDataChangedEvent, emitter.name)
}

func TestSyncServiceRejectsInvalidPathAndClosedDatabase(t *testing.T) {
	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	svc := NewSyncService(db, testutil.NewTestLogger())
	assert.Error(t, svc.Export("/missing/backup.msshbackup"))
	require.NoError(t, db.Close())
	assert.Error(t, svc.Export(filepath.Join(t.TempDir(), "backup.msshbackup")))
}

func TestValidateSnapshotRejectsUnknownColumnsBeforeRestore(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := NewSyncService(db, testutil.NewTestLogger()).snapshot()
	require.NoError(t, err)
	data.Tables["sessions"] = append(data.Tables["sessions"], map[string]any{"unknown_column": "bad"})
	err = validateSnapshot(db, data)
	assert.ErrorContains(t, err, "unknown column unknown_column")
}

func TestCloudSyncUploadDownloadAndConflict(t *testing.T) {
	var content []byte
	etag := ""
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodPut {
			if (etag == "" && request.Header.Get("If-None-Match") != "*") || (etag != "" && request.Header.Get("If-Match") != etag) {
				writer.WriteHeader(http.StatusPreconditionFailed)
				return
			}
			content, _ = io.ReadAll(request.Body)
			etag = `"v1"`
			writer.Header().Set("ETag", etag)
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		if len(content) == 0 {
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		writer.Header().Set("ETag", etag)
		_, _ = writer.Write(content)
	}))
	defer server.Close()

	db := testutil.NewTestDB(t)
	require.NoError(t, store.SetAuditEnabled(db, true))
	setSyncMasterKey(t, db, syncTestMasterKey)
	_, err := store.CreateSession(db, model.Session{Name: "cloud", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm"})
	require.NoError(t, err)
	syncService := NewSyncService(db, testutil.NewTestLogger())
	require.NoError(t, syncService.SyncToCloud(server.URL, "", ""))
	require.NoError(t, syncService.TestCloudConnection(server.URL, "", ""))
	assert.Equal(t, `"upload"`, settingValue(t, db, syncDirectionSetting))
	assert.Equal(t, `3`, settingValue(t, db, syncVersionSetting))
	auditEvents, err := store.ListAuditEvents(db, model.AuditFilter{Action: "cloud_upload", Limit: 10})
	require.NoError(t, err)
	require.Len(t, auditEvents, 1)
	assert.NotContains(t, auditEvents[0].Summary, server.URL)

	db2 := testutil.NewTestDB(t)
	setSyncMasterKey(t, db2, syncTestMasterKey)
	syncService2 := NewSyncService(db2, testutil.NewTestLogger())
	require.NoError(t, syncService2.SyncFromCloud(server.URL, "", ""))
	assert.Equal(t, `"download"`, settingValue(t, db2, syncDirectionSetting))
	sessions, err := store.ListSessions(db2, nil)
	require.NoError(t, err)
	found := false
	for _, session := range sessions {
		if session.Name == "cloud" {
			found = true
		}
	}
	require.True(t, found)

	etag = `"remote-change"`
	err = syncService.SyncToCloud(server.URL, "", "")
	require.ErrorContains(t, err, "conflict")
}

func TestReadCloudBackupRejectsOversizedPayload(t *testing.T) {
	_, err := readCloudBackup(io.LimitReader(zeroReader{}, maxCloudBackupSize+1))
	require.ErrorContains(t, err, "exceeds")
}

func TestSyncCodecAndCloudErrorPaths(t *testing.T) {
	t.Run("snapshot encoding and database errors", func(t *testing.T) {
		_, err := encodeEncryptedSnapshot(ExportData{Tables: map[string][]map[string]any{"bad": {{"value": make(chan int)}}}}, syncTestMasterKey)
		require.Error(t, err)
		require.Error(t, writePrivateFileAtomic(filepath.Join(t.TempDir(), "missing", "backup"), []byte("x")))

		memoryDB, err := sql.Open("sqlite", ":memory:")
		require.NoError(t, err)
		defer func() { _ = memoryDB.Close() }()
		memoryService := NewSyncService(memoryDB, testutil.NewTestLogger())
		_, err = memoryService.recoveryPath()
		require.ErrorContains(t, err, "database path is unavailable")

		db := testutil.NewTestDB(t)
		setSyncMasterKey(t, db, syncTestMasterKey)
		service := NewSyncService(db, testutil.NewTestLogger())
		require.NoError(t, db.Close())
		_, err = tableColumns(db, "sessions")
		require.Error(t, err)
		require.Error(t, validateSnapshot(db, ExportData{Tables: map[string][]map[string]any{}}))
		require.Error(t, service.writeRecoveryPoint(syncTestMasterKey))
		require.Error(t, service.saveCloudMetadata("etag", "upload"))
	})

	t.Run("cloud request and response errors", func(t *testing.T) {
		_, err := cloudRequest(http.MethodGet, "file:///tmp/config", "", "", nil)
		require.Error(t, err)
		request, err := cloudRequest(http.MethodGet, "https://example.com/config", "user", "pass", nil)
		require.NoError(t, err)
		username, password, ok := request.BasicAuth()
		assert.True(t, ok)
		assert.Equal(t, "user", username)
		assert.Equal(t, "pass", password)

		failureServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusInternalServerError) }))
		defer failureServer.Close()
		db := testutil.NewTestDB(t)
		setSyncMasterKey(t, db, syncTestMasterKey)
		service := NewSyncService(db, testutil.NewTestLogger())
		require.ErrorContains(t, service.TestCloudConnection(failureServer.URL, "", ""), "500")
		require.Error(t, service.SyncToCloud(failureServer.URL, "", ""))
		require.ErrorContains(t, service.SyncFromCloud(failureServer.URL, "", ""), "500")
	})

	t.Run("cloud payload decoding errors", func(t *testing.T) {
		_, err := decodeEncryptedSnapshot([]byte("not-json"), syncTestMasterKey)
		require.Error(t, err)
		content, err := encodeEncryptedSnapshot(ExportData{FormatVersion: syncFormatVersion, Tables: map[string][]map[string]any{}}, syncTestMasterKey)
		require.NoError(t, err)
		_, err = decodeEncryptedSnapshot(content, "wrong master key")
		require.Error(t, err)
		_, err = readCloudBackup(errorReader{})
		require.Error(t, err)
	})
}

type zeroReader struct{}

func (zeroReader) Read(buffer []byte) (int, error) {
	for index := range buffer {
		buffer[index] = 0
	}
	return len(buffer), nil
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) { return 0, assert.AnError }

func settingValue(t *testing.T, db *sql.DB, key string) string {
	t.Helper()
	var value string
	require.NoError(t, db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value))
	return value
}

func setSyncMasterKey(t *testing.T, db *sql.DB, key string) {
	t.Helper()
	require.NoError(t, store.SetSettings(db, []model.Setting{{Key: SyncMasterKeySetting, Namespace: "sync", Value: `"` + key + `"`, ValueType: "string", Version: 1}}))
}

type fakeSyncEventBus struct{ name string }

func (f *fakeSyncEventBus) Emit(name string, _ any) { f.name = name }
