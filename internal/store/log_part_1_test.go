package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

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
	assert.Equal(t, ended.UTC().Truncate(time.Second), *got.EndedAt)
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
	assert.Equal(t, ended.UTC().Truncate(time.Second), *got.EndedAt)
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
	assert.Equal(t, ended.UTC().Truncate(time.Second), *logs[0].EndedAt)
}

func TestEndSessionLog(t *testing.T) {
	db := setupTestDB(t)
	created, err := CreateSessionLog(db, model.SessionLog{DataPath: "/tmp/end.log"})
	require.NoError(t, err)

	before := time.Now().UTC().Add(-time.Second)
	require.NoError(t, EndSessionLog(db, created.ID))
	after := time.Now().UTC().Add(time.Second)

	ended, err := GetSessionLog(db, created.ID)
	require.NoError(t, err)
	require.NotNil(t, ended.EndedAt)
	assert.False(t, ended.EndedAt.Before(before))
	assert.False(t, ended.EndedAt.After(after))
}

func TestEndSessionLogNotFound(t *testing.T) {
	db := setupTestDB(t)
	assert.Error(t, EndSessionLog(db, 999))
}

func TestEndSessionLogClosedDB(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Close())
	assert.Error(t, EndSessionLog(db, 1))
}
