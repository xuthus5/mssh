package store

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
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
	folder, err := CreateFolder(db, "生产环境", nil)
	require.NoError(t, err)
	assert.Equal(t, "生产环境", folder.Name)
	folders, err := ListFolders(db)
	require.NoError(t, err)
	assert.Len(t, folders, 2)
	assert.Equal(t, "生产环境", folders[1].Name)
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
	folder, err := CreateFolder(db, "测试", nil)
	require.NoError(t, err)
	err = UpdateFolder(db, folder.ID, "更新后")
	require.NoError(t, err)
	folders, err := ListFolders(db)
	require.NoError(t, err)
	assert.Equal(t, "更新后", folders[1].Name)
	err = DeleteFolder(db, folder.ID)
	require.NoError(t, err)
	folders, err = ListFolders(db)
	require.NoError(t, err)
	assert.Len(t, folders, 1)
	assert.True(t, folders[0].IsDefault)
}

func TestListFoldersHasDefault(t *testing.T) {
	db := setupTestDB(t)
	folders, err := ListFolders(db)
	require.NoError(t, err)
	require.Len(t, folders, 1)
	assert.True(t, folders[0].IsDefault)
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
	folder, err := CreateFolder(db, "child", nil)
	require.NoError(t, err)
	var parent2 int64 = 2
	err = MoveFolder(db, folder.ID, &parent2)
	require.NoError(t, err)

	folders, err := ListFolders(db)
	require.NoError(t, err)
	var moved model.SessionFolder
	for _, item := range folders {
		if item.ID == folder.ID {
			moved = item
		}
	}
	require.NotNil(t, moved.ParentID)
	assert.Equal(t, int64(2), *moved.ParentID)
}

func TestDefaultFolderRulesAndDeleteMigration(t *testing.T) {
	db := setupTestDB(t)
	folders, err := ListFolders(db)
	require.NoError(t, err)
	defaultFolder := folders[0]
	require.Error(t, DeleteFolder(db, defaultFolder.ID))

	target, err := CreateFolder(db, "目标", nil)
	require.NoError(t, err)
	child, err := CreateFolder(db, "子分组", &target.ID)
	require.NoError(t, err)
	session, err := CreateSession(db, model.Session{FolderID: &target.ID, Name: "server", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
	require.NoError(t, err)
	require.NoError(t, DeleteFolder(db, target.ID))

	migrated, err := GetSession(db, session.ID)
	require.NoError(t, err)
	assert.Equal(t, defaultFolder.ID, *migrated.FolderID)
	folders, err = ListFolders(db)
	require.NoError(t, err)
	for _, folder := range folders {
		if folder.ID == child.ID {
			require.NotNil(t, folder.ParentID)
			assert.Equal(t, defaultFolder.ID, *folder.ParentID)
		}
	}
}

func TestDeleteFolderRollsBackOnMigrationFailures(t *testing.T) {
	tests := []struct{ name, trigger string }{
		{"session migration", `CREATE TRIGGER fail_move_session BEFORE UPDATE OF folder_id ON sessions BEGIN SELECT RAISE(ABORT, 'fail'); END`},
		{"child migration", `CREATE TRIGGER fail_move_child BEFORE UPDATE OF parent_id ON session_folders BEGIN SELECT RAISE(ABORT, 'fail'); END`},
		{"folder deletion", `CREATE TRIGGER fail_delete_folder BEFORE DELETE ON session_folders BEGIN SELECT RAISE(ABORT, 'fail'); END`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := setupTestDB(t)
			target, err := CreateFolder(db, "目标", nil)
			require.NoError(t, err)
			_, err = CreateFolder(db, "子分组", &target.ID)
			require.NoError(t, err)
			_, err = CreateSession(db, model.Session{FolderID: &target.ID, Name: "server", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 30})
			require.NoError(t, err)
			_, err = db.Exec(test.trigger)
			require.NoError(t, err)
			assert.Error(t, DeleteFolder(db, target.ID))
			var count int
			require.NoError(t, db.QueryRow("SELECT count(*) FROM session_folders WHERE id = ?", target.ID).Scan(&count))
			assert.Equal(t, 1, count)
		})
	}
}

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
