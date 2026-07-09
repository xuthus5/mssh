package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
	"mssh/internal/service/testutil"
)

func TestNewLogService(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db)
	assert.NotNil(t, svc)
	assert.NotNil(t, svc.recorders)
}

func TestLogService_List(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db)

	logs, err := svc.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestLogService_ListBySession(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	sess := model.Session{
		Name: "test-log", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	dataPath := filepath.Join(t.TempDir(), "recording.bin")
	svc := NewLogService(db)

	logID, err := svc.StartRecording(createdSess.ID, 80, 24, "xterm", dataPath)
	require.NoError(t, err)
	assert.NotZero(t, logID)

	logs, err := svc.List(&createdSess.ID)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.Equal(t, createdSess.ID, *logs[0].SessionID)
}

func TestLogService_StartRecording(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db)

	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	sess := model.Session{
		Name: "test-rec", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	dataPath := filepath.Join(t.TempDir(), "recording.bin")
	logID, err := svc.StartRecording(createdSess.ID, 80, 24, "xterm", dataPath)
	require.NoError(t, err)
	assert.NotZero(t, logID)

	_, err = os.Stat(dataPath)
	require.NoError(t, err)

	logs, err := svc.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
}

func TestLogService_StopRecording(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db)

	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	sess := model.Session{
		Name: "test-stop", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	dataPath := filepath.Join(t.TempDir(), "recording.bin")
	logID, err := svc.StartRecording(createdSess.ID, 80, 24, "xterm", dataPath)
	require.NoError(t, err)

	err = svc.StopRecording(logID)
	require.NoError(t, err)

	logs, err := svc.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
}

func TestLogService_StopRecordingNotActive(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db)

	err := svc.StopRecording(999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")
}

func TestLogService_GetRecording(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db)

	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	sess := model.Session{
		Name: "test-get", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	dataPath := filepath.Join(t.TempDir(), "recording.bin")
	logID, err := svc.StartRecording(createdSess.ID, 80, 24, "xterm", dataPath)
	require.NoError(t, err)
	_ = logID

	err = svc.StopRecording(logID)
	require.NoError(t, err)

	player, err := svc.GetRecording(dataPath)
	require.NoError(t, err)
	assert.NotNil(t, player)

	cols, rows, termType := player.Header()
	assert.Equal(t, 80, cols)
	assert.Equal(t, 24, rows)
	assert.Equal(t, "xterm", termType)

	assert.Len(t, player.Entries(), 0)
	_ = player.Close()
}

func TestLogService_GetRecordingInvalidFile(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db)

	_, err := svc.GetRecording("/nonexistent/path/recording.bin")
	assert.Error(t, err)
}

func TestLogService_Delete(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db)

	sessionSvc := NewSessionService(db, newMockEventBus(), 30)
	sess := model.Session{
		Name: "test-del", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	dataPath := filepath.Join(t.TempDir(), "recording.bin")
	logID, err := svc.StartRecording(createdSess.ID, 80, 24, "xterm", dataPath)
	require.NoError(t, err)

	err = svc.Delete(logID)
	require.NoError(t, err)

	logs, err := svc.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestLogService_StartRecordingCreateLogError(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db)

	invalidPath := filepath.Join(t.TempDir(), "nonexistent-subdir", "rec.bin")
	_, err := svc.StartRecording(1, 80, 24, "xterm", invalidPath)
	assert.Error(t, err)
}
