package service

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

func TestLogService_GetRecordingRejectsSymlinkOutsideRecordings(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	service := NewLogService(db, dataDir, testutil.NewTestLogger())
	session := createLogTestSession(t, db, "symlink")
	_, err := service.StartTerminalRecording("symlink", session.ID, 80, 24, "xterm")
	require.NoError(t, err)
	require.NoError(t, service.StopTerminalRecording("symlink"))
	logs, err := service.List(nil)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	content, err := os.ReadFile(logs[0].DataPath)
	require.NoError(t, err)
	outside := filepath.Join(t.TempDir(), "outside.msshlog")
	require.NoError(t, os.WriteFile(outside, content, 0o600))
	link := filepath.Join(dataDir, "recordings", "outside.msshlog")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	_, err = service.GetRecording(link)
	assert.ErrorContains(t, err, "outside recordings directory")
}

func TestLogService_GetRecordingRejectsSymlinkedRecordingsDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	db := testutil.NewTestDB(t)
	dataDir := t.TempDir()
	service := NewLogService(db, dataDir, testutil.NewTestLogger())
	outsideDir := t.TempDir()
	path := filepath.Join(outsideDir, "outside.msshlog")
	recorder, err := ssh.NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)
	require.NoError(t, recorder.Close())
	require.NoError(t, os.Symlink(outsideDir, filepath.Join(dataDir, "recordings")))

	_, err = service.GetRecording(filepath.Join(dataDir, "recordings", "outside.msshlog"))

	require.Error(t, err)
	assert.ErrorContains(t, err, "recordings directory")
}
