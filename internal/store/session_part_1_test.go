package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSetDefaultFolder(t *testing.T) {
	db := setupTestDB(t)
	folder, err := CreateFolder(db, "新默认", nil)
	require.NoError(t, err)
	require.NoError(t, SetDefaultFolder(db, folder.ID))
	folders, err := ListFolders(db)
	require.NoError(t, err)
	for _, item := range folders {
		assert.Equal(t, item.ID == folder.ID, item.IsDefault)
	}
}

func TestSetDefaultFolderRollsBackOnUpdateFailure(t *testing.T) {
	db := setupTestDB(t)
	folder, err := CreateFolder(db, "新默认", nil)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TRIGGER fail_set_default BEFORE UPDATE OF is_default ON session_folders BEGIN SELECT RAISE(ABORT, 'fail'); END`)
	require.NoError(t, err)
	assert.Error(t, SetDefaultFolder(db, folder.ID))
	defaultID, err := GetDefaultFolderID(db)
	require.NoError(t, err)
	assert.NotEqual(t, folder.ID, defaultID)
}

func TestDefaultFolderInvalidOperations(t *testing.T) {
	db := setupTestDB(t)
	assert.Error(t, SetDefaultFolder(db, 999))
	assert.Error(t, DeleteFolder(db, 999))
	defaultID, err := GetDefaultFolderID(db)
	require.NoError(t, err)
	assert.NotZero(t, defaultID)
}

func TestGetDefaultFolderIDClosedDB(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())
	_, err := GetDefaultFolderID(db)
	assert.Error(t, err)
}

func TestDefaultFolderMissingAndClosedDB(t *testing.T) {
	db := setupTestDB(t)
	_, err := db.Exec("UPDATE session_folders SET is_default = 0")
	require.NoError(t, err)
	_, err = GetDefaultFolderID(db)
	assert.Error(t, err)
	_, err = CreateSession(db, model.Session{Name: "orphan", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
	assert.Error(t, err)
	require.NoError(t, db.Close())
	assert.Error(t, SetDefaultFolder(db, 1))
}

func TestMoveSession(t *testing.T) {
	db := setupTestDB(t)
	var folderID int64 = 1
	s := model.Session{FolderID: &folderID, Name: "web", Host: "10.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, Password: "pwd", KeepAlive: 30}
	created, err := CreateSession(db, s)
	require.NoError(t, err)

	folder, err := CreateFolder(db, "目标分组", nil)
	require.NoError(t, err)
	newFolderID := folder.ID
	err = MoveSession(db, created.ID, &newFolderID)
	require.NoError(t, err)

	fetched, err := GetSession(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), *fetched.FolderID)
}

func TestCreateSessionClosedDB(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())
	_, err := CreateSession(db, model.Session{Name: "x", Host: "1.1.1.1", Port: 22, Username: "u", AuthMethod: model.AuthPassword, KeepAlive: 30})
	assert.Error(t, err)
}

func TestListSessionsClosedDB(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())
	_, err := ListSessions(db, nil)
	assert.Error(t, err)
}

func TestGetSessionClosedDB(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())
	_, err := GetSession(db, 1)
	assert.Error(t, err)
}

func TestListFoldersClosedDB(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())
	_, err := ListFolders(db)
	assert.Error(t, err)
}
