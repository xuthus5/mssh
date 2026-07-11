package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
)

func TestCreateAndListSessionLogs(t *testing.T) {
	db := setupTestDB(t)
	now := time.Now()
	l := model.SessionLog{
		StartedAt: now, DataPath: "/var/log/mssh/session_1.log",
	}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "/var/log/mssh/session_1.log", created.DataPath)

	logs, err := ListSessionLogs(db)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.Equal(t, "/var/log/mssh/session_1.log", logs[0].DataPath)
}

func TestUpdateSessionLog(t *testing.T) {
	db := setupTestDB(t)
	now := time.Now()
	l := model.SessionLog{
		StartedAt: now, DataPath: "/tmp/old.log",
	}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)

	created.DataPath = "/tmp/new.log"
	err = UpdateSessionLog(db, *created)
	require.NoError(t, err)

	logs, err := ListSessionLogs(db)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.Equal(t, "/tmp/new.log", logs[0].DataPath)
}

func TestDeleteSessionLog(t *testing.T) {
	db := setupTestDB(t)
	now := time.Now()
	l := model.SessionLog{
		StartedAt: now, DataPath: "/tmp/temp.log",
	}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)

	err = DeleteSessionLog(db, created.ID)
	require.NoError(t, err)

	logs, err := ListSessionLogs(db)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestSessionLogWithEndedAt(t *testing.T) {
	db := setupTestDB(t)
	now := time.Now()
	ended := now.Add(time.Hour)
	l := model.SessionLog{
		StartedAt: now, EndedAt: &ended, DataPath: "/tmp/ended.log",
	}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)
	assert.NotNil(t, created.EndedAt)

	logs, err := ListSessionLogs(db)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.NotNil(t, logs[0].EndedAt)
}

func TestSessionLogWithSessionID(t *testing.T) {
	db := setupTestDB(t)
	s := model.Session{
		Name: "log-session", Host: "10.0.0.1", Port: 22,
		Username: "root", AuthMethod: model.AuthPassword, Password: "enc",
		KeepAlive: 30, TermType: "xterm-256color",
	}
	session, err := CreateSession(db, s)
	require.NoError(t, err)

	now := time.Now()
	l := model.SessionLog{
		SessionID: &session.ID, StartedAt: now, DataPath: "/tmp/with_session.log",
	}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)
	assert.Equal(t, session.ID, *created.SessionID)

	logs, err := ListSessionLogs(db)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.NotNil(t, logs[0].SessionID)
	assert.Equal(t, session.ID, *logs[0].SessionID)
}

func TestListSessionLogsEmpty(t *testing.T) {
	db := setupTestDB(t)
	logs, err := ListSessionLogs(db)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestGetSessionLog(t *testing.T) {
	db := setupTestDB(t)
	now := time.Now()
	l := model.SessionLog{
		StartedAt: now, DataPath: "/tmp/get.log",
	}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)

	got, err := GetSessionLog(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, got.ID)
	assert.Equal(t, "/tmp/get.log", got.DataPath)
}

func TestGetSessionLogNotFound(t *testing.T) {
	db := setupTestDB(t)
	_, err := GetSessionLog(db, 999)
	assert.Error(t, err)
}

func TestListSessionLogsBySession(t *testing.T) {
	db := setupTestDB(t)
	s := model.Session{
		Name: "log-filter", Host: "10.0.0.1", Port: 22,
		Username: "root", AuthMethod: model.AuthPassword, Password: "enc",
		KeepAlive: 30, TermType: "xterm-256color",
	}
	session, err := CreateSession(db, s)
	require.NoError(t, err)

	now := time.Now()
	l1 := model.SessionLog{SessionID: &session.ID, StartedAt: now, DataPath: "/tmp/a.log"}
	_, err = CreateSessionLog(db, l1)
	require.NoError(t, err)

	l2 := model.SessionLog{SessionID: &session.ID, StartedAt: now.Add(time.Hour), DataPath: "/tmp/b.log"}
	_, err = CreateSessionLog(db, l2)
	require.NoError(t, err)

	other := model.SessionLog{StartedAt: now, DataPath: "/tmp/other.log"}
	_, err = CreateSessionLog(db, other)
	require.NoError(t, err)

	logs, err := ListSessionLogsBySession(db, session.ID)
	require.NoError(t, err)
	assert.Len(t, logs, 2)
	for _, log := range logs {
		assert.Equal(t, session.ID, *log.SessionID)
	}
}

func TestListSessionLogsBySessionEmpty(t *testing.T) {
	db := setupTestDB(t)
	logs, err := ListSessionLogsBySession(db, 999)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestGetSessionLogClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	_, err := GetSessionLog(db, 1)
	assert.Error(t, err)
}

func TestListSessionLogsBySessionClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	_, err := ListSessionLogsBySession(db, 1)
	assert.Error(t, err)
}

func TestUpdateSessionLogClosedDB(t *testing.T) {
	db := setupTestDB(t)
	now := time.Now()
	l := model.SessionLog{StartedAt: now, DataPath: "/tmp/closed.log"}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)
	db.Close()
	err = UpdateSessionLog(db, *created)
	assert.Error(t, err)
}

func TestDeleteSessionLogClosedDB(t *testing.T) {
	db := setupTestDB(t)
	now := time.Now()
	l := model.SessionLog{StartedAt: now, DataPath: "/tmp/del-closed.log"}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)
	db.Close()
	err = DeleteSessionLog(db, created.ID)
	assert.Error(t, err)
}

func TestListSessionLogsClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	_, err := ListSessionLogs(db)
	assert.Error(t, err)
}

func TestCreateSessionLogClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	now := time.Now()
	l := model.SessionLog{StartedAt: now, DataPath: "/tmp/create-closed.log"}
	_, err := CreateSessionLog(db, l)
	assert.Error(t, err)
}

func TestUpdateSessionLogWithEndedAt(t *testing.T) {
	db := setupTestDB(t)
	now := time.Now()
	ended := now.Add(time.Hour)
	l := model.SessionLog{StartedAt: now, DataPath: "/tmp/update-ended.log"}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)

	created.EndedAt = &ended
	err = UpdateSessionLog(db, *created)
	require.NoError(t, err)

	got, err := GetSessionLog(db, created.ID)
	require.NoError(t, err)
	require.NotNil(t, got.EndedAt)
	// 存储层以本地时间字符串往返，比较秒级部分即可
	assert.Equal(t, ended.Format("2006-01-02 15:04:05"), got.EndedAt.Format("2006-01-02 15:04:05"))
}

func TestGetSessionLogWithEndedAt(t *testing.T) {
	db := setupTestDB(t)
	now := time.Now()
	ended := now.Add(2 * time.Hour)
	l := model.SessionLog{StartedAt: now, EndedAt: &ended, DataPath: "/tmp/get-ended.log"}
	created, err := CreateSessionLog(db, l)
	require.NoError(t, err)

	got, err := GetSessionLog(db, created.ID)
	require.NoError(t, err)
	assert.NotNil(t, got.EndedAt)
	assert.Equal(t, ended.Format("2006-01-02 15:04:05"), got.EndedAt.Format("2006-01-02 15:04:05"))
}

func TestListSessionLogsBySessionWithEndedAt(t *testing.T) {
	db := setupTestDB(t)
	s := model.Session{
		Name: "log-ended", Host: "10.0.0.1", Port: 22,
		Username: "root", AuthMethod: model.AuthPassword, Password: "enc",
		KeepAlive: 30, TermType: "xterm-256color",
	}
	session, err := CreateSession(db, s)
	require.NoError(t, err)

	now := time.Now()
	ended := now.Add(time.Hour)
	l := model.SessionLog{SessionID: &session.ID, StartedAt: now, EndedAt: &ended, DataPath: "/tmp/by-sess-ended.log"}
	_, err = CreateSessionLog(db, l)
	require.NoError(t, err)

	logs, err := ListSessionLogsBySession(db, session.ID)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	require.NotNil(t, logs[0].EndedAt)
	assert.Equal(t, ended.Format("2006-01-02 15:04:05"), logs[0].EndedAt.Format("2006-01-02 15:04:05"))
}
