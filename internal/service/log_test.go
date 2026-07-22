package service

import (
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
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
	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-log", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	logID, err := svc.StartTerminalRecording("term-list", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)
	assert.NotZero(t, logID)
	t.Cleanup(func() { _ = svc.StopTerminalRecordingIfActive("term-list") })

	logs, err := svc.List(&createdSess.ID)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.Equal(t, createdSess.ID, *logs[0].SessionID)
}

func TestLogService_StartTerminalRecordingCreatesFile(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-rec", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	logID, err := svc.StartTerminalRecording("term-create", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)
	assert.NotZero(t, logID)
	t.Cleanup(func() { _ = svc.StopTerminalRecordingIfActive("term-create") })

	logs, err := svc.List(nil)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	_, err = os.Stat(logs[0].DataPath)
	require.NoError(t, err)

	assert.Equal(t, logID, logs[0].ID)
}

func TestLogService_StartTerminalRecordingUsesSafeRandomPath(t *testing.T) {
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	svc := NewLogService(db, dataDir, testutil.NewTestLogger())
	created := createLogTestSession(t, db, "safe-path")

	_, err := svc.StartTerminalRecording("../escape", created.ID, 80, 24, "xterm")
	require.NoError(t, err)
	t.Cleanup(func() { _ = svc.StopTerminalRecordingIfActive("../escape") })

	logs, err := svc.List(nil)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	recordingsDir := filepath.Join(dataDir, "recordings")
	assert.Equal(t, filepath.Clean(recordingsDir), filepath.Dir(logs[0].DataPath))
	assert.NotContains(t, filepath.Base(logs[0].DataPath), "escape")
	_, err = os.Stat(filepath.Join(dataDir, "escape.msshlog"))
	assert.True(t, os.IsNotExist(err))
	info, err := os.Stat(logs[0].DataPath)
	require.NoError(t, err)
	if runtime.GOOS != "windows" {
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	}
}

func TestLogService_StartTerminalRecordingRejectsConcurrentDuplicates(t *testing.T) {
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	svc := NewLogService(db, dataDir, testutil.NewTestLogger())
	created := createLogTestSession(t, db, "duplicate")

	const attempts = 8
	start := make(chan struct{})
	results := make(chan error, attempts)
	var workers sync.WaitGroup
	workers.Add(attempts)
	for range attempts {
		go func() {
			defer workers.Done()
			<-start
			_, err := svc.StartTerminalRecording("term-duplicate", created.ID, 80, 24, "xterm")
			results <- err
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	t.Cleanup(func() { _ = svc.StopTerminalRecordingIfActive("term-duplicate") })

	successes := 0
	for err := range results {
		if err == nil {
			successes++
			continue
		}
		assert.ErrorContains(t, err, "already recording")
	}
	assert.Equal(t, 1, successes)
	logs, err := svc.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	files, err := os.ReadDir(filepath.Join(dataDir, "recordings"))
	require.NoError(t, err)
	assert.Len(t, files, 1)
}

func TestLogService_StopTerminalRecording(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-stop", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	_, err = svc.StartTerminalRecording("term-stop", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)

	err = svc.StopTerminalRecording("term-stop")
	require.NoError(t, err)

	logs, err := svc.List(nil)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	assert.NotNil(t, logs[0].EndedAt)
}

func TestLogService_StopTerminalRecordingNotActive(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	err := svc.StopTerminalRecording("term-missing")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not active")
}

func TestLogService_GetRecording(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-get", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	_, err = svc.StartTerminalRecording("term-get", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)

	err = svc.StopTerminalRecording("term-get")
	require.NoError(t, err)
	logs, err := svc.List(nil)
	require.NoError(t, err)
	require.Len(t, logs, 1)

	player, err := svc.GetRecording(logs[0].DataPath)
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

	sessionSvc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	sess := model.Session{
		Name: "test-del", Host: "10.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, Password: "enc", KeepAlive: 30, TermType: "xterm",
	}
	createdSess, err := sessionSvc.CreateSession(model.SessionInputFrom(sess))
	require.NoError(t, err)

	logID, err := svc.StartTerminalRecording("term-delete", createdSess.ID, 80, 24, "xterm")
	require.NoError(t, err)
	require.NoError(t, svc.StopTerminalRecording("term-delete"))

	err = svc.Delete(logID)
	require.NoError(t, err)

	logs, err := svc.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 0)
}

func TestLogService_StartTerminalRecordingCreateDirectoryError(t *testing.T) {
	db := testutil.NewTestDB(t)
	dataDir := filepath.Join(t.TempDir(), "file")
	require.NoError(t, os.WriteFile(dataDir, []byte("not a directory"), 0o600))
	svc := NewLogService(db, dataDir, testutil.NewTestLogger())

	_, err := svc.StartTerminalRecording("term-invalid-dir", 1, 80, 24, "xterm")
	assert.Error(t, err)
}

func TestLogService_StartTerminalRecordingWithoutSession(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewLogService(db, t.TempDir(), testutil.NewTestLogger())
	logID, err := svc.StartTerminalRecording("term-local", 0, 80, 24, "xterm")
	require.NoError(t, err)
	assert.NotZero(t, logID)
	t.Cleanup(func() { _ = svc.StopTerminalRecordingIfActive("term-local") })
	sessionID := int64(0)
	logs, err := svc.List(&sessionID)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	assert.Nil(t, logs[0].SessionID)
}
