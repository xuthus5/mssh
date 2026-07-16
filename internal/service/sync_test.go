package service

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

const syncTestMasterKey = "correct horse battery staple"

func TestSyncServiceExportImportRestoresEncryptedFullSnapshot(t *testing.T) {
	db := testutil.NewTestDB(t)
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
	require.NoError(t, NewSyncService(db2, testutil.NewTestLogger()).Import(path))
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

func setSyncMasterKey(t *testing.T, db *sql.DB, key string) {
	t.Helper()
	require.NoError(t, store.SetSettings(db, []model.Setting{{Key: SyncMasterKeySetting, Namespace: "sync", Value: `"` + key + `"`, ValueType: "string", Version: 1}}))
}
