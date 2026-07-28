package service

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestLogServiceDeleteRejectsRecordingOutsideDataDirectory(t *testing.T) {
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	service := NewLogService(db, dataDir, testutil.NewTestLogger())
	sessionService := NewSessionService(db, newMockEventBus(), 30, dataDir, nil, testutil.NewTestLogger())
	session, err := sessionService.CreateSession(model.SessionInputFrom(model.Session{
		Name: "unsafe-log", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)

	sentinel := filepath.Join(t.TempDir(), "sentinel.msshlog")
	require.NoError(t, os.WriteFile(sentinel, []byte("must survive"), 0o600))
	logEntry, err := service.createSessionLog(db, model.SessionLog{SessionID: &session.ID, DataPath: sentinel})
	require.NoError(t, err)

	err = service.Delete(logEntry.ID)
	require.Error(t, err)
	assert.ErrorContains(t, err, "outside recordings directory")
	_, statErr := os.Stat(sentinel)
	require.NoError(t, statErr)
	logs, err := service.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.Equal(t, sentinel, logs[0].DataPath)
}

func TestLogServiceDeleteRejectsRecordingSymlinkOutsideDataDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	service := NewLogService(db, dataDir, testutil.NewTestLogger())
	sessionService := NewSessionService(db, newMockEventBus(), 30, dataDir, nil, testutil.NewTestLogger())
	session, err := sessionService.CreateSession(model.SessionInputFrom(model.Session{
		Name: "unsafe-symlink-log", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)

	recordingsDir := filepath.Join(dataDir, "recordings")
	require.NoError(t, os.MkdirAll(recordingsDir, 0o700))
	outsidePath := filepath.Join(t.TempDir(), "sentinel.msshlog")
	require.NoError(t, os.WriteFile(outsidePath, []byte("must survive"), 0o600))
	symlinkPath := filepath.Join(recordingsDir, "linked.msshlog")
	if err := os.Symlink(outsidePath, symlinkPath); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	logEntry, err := service.createSessionLog(db, model.SessionLog{SessionID: &session.ID, DataPath: symlinkPath})
	require.NoError(t, err)

	err = service.Delete(logEntry.ID)
	require.Error(t, err)
	assert.ErrorContains(t, err, "outside recordings directory")
	_, statErr := os.Stat(outsidePath)
	require.NoError(t, statErr)
	logs, err := service.List(nil)
	require.NoError(t, err)
	assert.Len(t, logs, 1)
}
