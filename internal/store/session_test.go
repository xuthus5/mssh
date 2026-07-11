package store

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := OpenDB(t.TempDir())
	require.NoError(t, err)
	_ = Migrate(db)
	t.Cleanup(func() { db.Close() })
	return db
}

func TestCreateAndListFolders(t *testing.T) {
	db := setupTestDB(t)
	var parentID int64 = 0
	folder, err := CreateFolder(db, "生产环境", &parentID)
	require.NoError(t, err)
	assert.Equal(t, "生产环境", folder.Name)
	folders, err := ListFolders(db)
	require.NoError(t, err)
	assert.Len(t, folders, 1)
	assert.Equal(t, "生产环境", folders[0].Name)
}

func TestCreateAndListSessions(t *testing.T) {
	db := setupTestDB(t)
	s := model.Session{
		Name: "web-server", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "encrypted", KeepAlive: 30, TermType: "xterm-256color",
	}
	created, err := CreateSession(db, s)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	sessions, err := ListSessions(db, nil)
	require.NoError(t, err)
	assert.Len(t, sessions, 1)
	assert.Equal(t, "web-server", sessions[0].Name)
}

func TestUpdateAndDeleteSession(t *testing.T) {
	db := setupTestDB(t)
	s := model.Session{Name: "old", Host: "1.1.1.1", Port: 22, Username: "u", AuthMethod: model.AuthPassword, KeepAlive: 30}
	created, _ := CreateSession(db, s)
	created.Name = "new"
	err := UpdateSession(db, *created)
	require.NoError(t, err)
	sessions, _ := ListSessions(db, nil)
	assert.Equal(t, "new", sessions[0].Name)
	err = DeleteSession(db, created.ID)
	require.NoError(t, err)
	sessions, _ = ListSessions(db, nil)
	assert.Len(t, sessions, 0)
}

func TestUpdateAndDeleteFolder(t *testing.T) {
	db := setupTestDB(t)
	var parentID int64 = 0
	folder, err := CreateFolder(db, "测试", &parentID)
	require.NoError(t, err)
	err = UpdateFolder(db, folder.ID, "更新后")
	require.NoError(t, err)
	folders, err := ListFolders(db)
	require.NoError(t, err)
	assert.Equal(t, "更新后", folders[0].Name)
	err = DeleteFolder(db, folder.ID)
	require.NoError(t, err)
	folders, err = ListFolders(db)
	require.NoError(t, err)
	assert.Len(t, folders, 0)
}

func TestListFoldersEmpty(t *testing.T) {
	db := setupTestDB(t)
	folders, err := ListFolders(db)
	require.NoError(t, err)
	assert.Len(t, folders, 0)
}

func TestListSessionsByFolder(t *testing.T) {
	db := setupTestDB(t)
	var parentID int64 = 0
	folder, _ := CreateFolder(db, "生产环境", &parentID)
	s := model.Session{
		FolderID: &folder.ID, Name: "web-server", Host: "10.0.0.1", Port: 22,
		Username: "root", AuthMethod: model.AuthPassword, Password: "encrypted",
		KeepAlive: 30, TermType: "xterm-256color",
	}
	_, err := CreateSession(db, s)
	require.NoError(t, err)
	sessions, err := ListSessions(db, &folder.ID)
	require.NoError(t, err)
	assert.Len(t, sessions, 1)
	assert.Equal(t, "web-server", sessions[0].Name)
	sessions, err = ListSessions(db, nil)
	require.NoError(t, err)
	assert.Len(t, sessions, 1)
}

func TestGetSession(t *testing.T) {
	db := setupTestDB(t)
	s := model.Session{Name: "web", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, Password: "pwd", KeepAlive: 30}
	created, err := CreateSession(db, s)
	require.NoError(t, err)

	fetched, err := GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, fetched.ID)
	assert.Equal(t, "web", fetched.Name)
	assert.Equal(t, "10.0.0.1", fetched.Host)
}

func TestGetSessionNotFound(t *testing.T) {
	db := setupTestDB(t)
	_, err := GetSession(db, 999)
	assert.Error(t, err)
}

func TestMoveFolder(t *testing.T) {
	db := setupTestDB(t)
	var parent1 int64 = 1
	folder, err := CreateFolder(db, "child", &parent1)
	require.NoError(t, err)
	var parent2 int64 = 2
	err = MoveFolder(db, folder.ID, &parent2)
	require.NoError(t, err)

	folders, err := ListFolders(db)
	require.NoError(t, err)
	assert.Equal(t, int64(2), *folders[0].ParentID)
}

func TestMoveSession(t *testing.T) {
	db := setupTestDB(t)
	var folderID int64 = 1
	s := model.Session{FolderID: &folderID, Name: "web", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, Password: "pwd", KeepAlive: 30}
	created, err := CreateSession(db, s)
	require.NoError(t, err)

	var newFolderID int64 = 2
	err = MoveSession(db, created.ID, &newFolderID)
	require.NoError(t, err)

	fetched, err := GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), *fetched.FolderID)
}

func TestGetSetSetting(t *testing.T) {
	db := setupTestDB(t)
	v, err := GetSetting(db, "nonexistent")
	require.NoError(t, err)
	assert.Equal(t, "", v)
	err = SetSetting(db, "max_pool_size", "32")
	require.NoError(t, err)
	v, err = GetSetting(db, "max_pool_size")
	require.NoError(t, err)
	assert.Equal(t, "32", v)
}

func TestCreateSessionClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	_, err := CreateSession(db, model.Session{Name: "x", Host: "1.1.1.1", Port: 22, Username: "u", AuthMethod: model.AuthPassword, KeepAlive: 30})
	assert.Error(t, err)
}

func TestListSessionsClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	_, err := ListSessions(db, nil)
	assert.Error(t, err)
}

func TestGetSessionClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	_, err := GetSession(db, 1)
	assert.Error(t, err)
}

func TestListFoldersClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	_, err := ListFolders(db)
	assert.Error(t, err)
}
