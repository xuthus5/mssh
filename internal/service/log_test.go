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
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	assert.NotNil(t, svc)
	assert.NotNil(t, svc.recorders)
}

func TestLogService_List(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	logs, err := svc.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestLogService_ListBySession(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-log", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	dataPath := filepath.Join(t.TempDir(), "recording.bin")
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

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
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
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
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
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
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	err := svc.StopRecording(999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")
}

func TestLogService_GetRecording(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
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
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	_, err := svc.GetRecording("/nonexistent/path/recording.bin")
	assert.Error(t, err)
}

func TestLogService_Delete(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
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
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	invalidPath := filepath.Join(t.TempDir(), "nonexistent-subdir", "rec.bin")
	_, err := svc.StartRecording(1, 80, 24, "xterm", invalidPath)
	assert.Error(t, err)
}

func TestLogService_ListBySessionNoMatch(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-nomatch", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	dataPath := filepath.Join(t.TempDir(), "recording-nomatch.bin")
	_, err = svc.StartRecording(createdSess.ID, 80, 24, "xterm", dataPath)
	require.NoError(t, err)

	otherID := int64(999)
	logs, err := svc.List(&otherID)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestLogService_DeleteNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	err := svc.Delete(999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "delete")
}

func TestLogService_StopRecordingTwice(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-stoptwice", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	dataPath := filepath.Join(t.TempDir(), "recording-stop2.bin")
	logID, err := svc.StartRecording(createdSess.ID, 80, 24, "xterm", dataPath)
	require.NoError(t, err)

	err = svc.StopRecording(logID)
	require.NoError(t, err)

	err = svc.StopRecording(logID)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")
}

func TestLogService_StartRecordingClosedDB(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	dataPath := filepath.Join(t.TempDir(), "recording-closed.bin")
	db.Close()
	_, err := svc.StartRecording(1, 80, 24, "xterm", dataPath)
	assert.Error(t, err)
}

func TestLogService_DeleteWithDataPath(t *testing.T) {
	db := testutil.NewTestDB(t)
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-del-path", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	dataPath := filepath.Join(t.TempDir(), "recording-del.bin")
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	logID, err := svc.StartRecording(createdSess.ID, 80, 24, "xterm", dataPath)
	require.NoError(t, err)

	err = svc.Delete(logID)
	require.NoError(t, err)

	logs, err := svc.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestLogService_StartTerminalRecording(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-term-rec", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	logID, err := svc.StartTerminalRecording("term-test-1", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)
	assert.NotZero(t, logID)

	err = svc.StopTerminalRecording("term-test-1")
	require.NoError(t, err)

	err = svc.StopTerminalRecording("term-test-1")
	assert.Error(t, err)
}

func TestLogService_StopTerminalRecordingNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	err := svc.StopTerminalRecording("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")
}

func TestLogService_HandleOutput(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-handle-out", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(sess)
	require.NoError(t, err)

	_, err = svc.StartTerminalRecording("term-out", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)

	svc.HandleOutput("term-out", []byte("hello output"))
	svc.HandleOutput("nonexistent", []byte("no-op"))

	err = svc.StopTerminalRecording("term-out")
	require.NoError(t, err)
}

func TestLogService_GetRecordingNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	_, err := svc.GetRecording("/nonexistent/recording.bin")
	assert.Error(t, err)
}
