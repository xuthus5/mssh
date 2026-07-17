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
	created, err := store.CreateSession(db, model.Session{FolderID: &folder.ID, Name: "s1", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, Password: "secret", KeepAlive: 30, TermType: "xterm"})
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
	tunnels, err := store.ListTunnels(db2)
	require.NoError(t, err)
	assert.Len(t, tunnels, 1)
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
	assert.Equal(t, `2`, settingValue(t, db, syncVersionSetting))
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

type zeroReader struct{}

func (zeroReader) Read(buffer []byte) (int, error) {
	for index := range buffer {
		buffer[index] = 0
	}
	return len(buffer), nil
}

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
