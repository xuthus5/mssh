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
