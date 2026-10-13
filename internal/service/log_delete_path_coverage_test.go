package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

// 覆盖 stageRecordingDeletion 在空路径时的无操作分支。
func TestStageRecordingDeletionEmptyPathIsNoop(t *testing.T) {
	service := NewLogService(testutil.NewTestDB(t), t.TempDir(), testutil.NewTestLogger())

	staged, err := service.stageRecordingDeletion("")

	require.NoError(t, err)
	assert.False(t, staged.exists)
	assert.Empty(t, staged.stagedPath)
}

// 覆盖 validRecordingDeletionPath 在 dataDir 缺失时的拒绝分支。
func TestValidRecordingDeletionPathRequiresDataDir(t *testing.T) {
	service := NewLogService(testutil.NewTestDB(t), "", testutil.NewTestLogger())

	_, err := service.validRecordingDeletionPath("/tmp/recording.msshlog")

	require.ErrorContains(t, err, "unavailable")
}

func recordingDeletionFixture(t *testing.T) (*LogService, string) {
	t.Helper()
	dataDir := t.TempDir()
	recordingsDir := filepath.Join(dataDir, "recordings")
	require.NoError(t, os.MkdirAll(recordingsDir, 0o700))
	return NewLogService(testutil.NewTestDB(t), dataDir, testutil.NewTestLogger()), recordingsDir
}

// 覆盖记录路径父目录无法解析、父目录经符号链接逃逸、以及文件经符号链接逃逸的分支。
func TestValidRecordingDeletionPathRejectsEscapes(t *testing.T) {
	service, recordingsDir := recordingDeletionFixture(t)

	_, err := service.validRecordingDeletionPath(filepath.Join(recordingsDir, "missing-dir", "recording.msshlog"))
	require.ErrorContains(t, err, "resolve recording parent")

	outside := filepath.Join(filepath.Dir(recordingsDir), "outside")
	require.NoError(t, os.MkdirAll(outside, 0o700))
	require.NoError(t, os.Symlink(outside, filepath.Join(recordingsDir, "escape-dir")))
	_, err = service.validRecordingDeletionPath(filepath.Join(recordingsDir, "escape-dir", "recording.msshlog"))
	require.ErrorContains(t, err, "outside recordings directory")

	secret := filepath.Join(outside, "secret.msshlog")
	require.NoError(t, os.WriteFile(secret, []byte("secret"), 0o600))
	require.NoError(t, os.Symlink(secret, filepath.Join(recordingsDir, "leak.msshlog")))
	_, err = service.validRecordingDeletionPath(filepath.Join(recordingsDir, "leak.msshlog"))
	require.ErrorContains(t, err, "outside recordings directory")
}
