package applog

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagerWritesDailyFileAndPurgesOldLogs(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	manager := New(Options{Dir: dir, RetentionDays: 2, Now: func() time.Time { return now }})
	t.Cleanup(func() { _ = manager.Close() })

	require.NoError(t, manager.Configure(dir, 2))
	_, err := manager.Write([]byte("hello-log\n"))
	require.NoError(t, err)

	current := filepath.Join(dir, "2026-07-15.log")
	content, err := os.ReadFile(current)
	require.NoError(t, err)
	assert.Contains(t, string(content), "hello-log")

	oldPath := filepath.Join(dir, "2026-07-10.log")
	require.NoError(t, os.WriteFile(oldPath, []byte("old\n"), 0o600))
	boundaryPath := filepath.Join(dir, "2026-07-13.log")
	require.NoError(t, os.WriteFile(boundaryPath, []byte("boundary\n"), 0o600))
	keepPath := filepath.Join(dir, "2026-07-14.log")
	require.NoError(t, os.WriteFile(keepPath, []byte("keep\n"), 0o600))
	require.NoError(t, manager.Configure(dir, 2))
	_, err = os.Stat(oldPath)
	assert.Error(t, err)
	_, err = os.Stat(boundaryPath)
	assert.Error(t, err)
	_, err = os.Stat(keepPath)
	assert.NoError(t, err)
	_, err = os.Stat(current)
	assert.NoError(t, err)
}

func TestNormalizeHelpers(t *testing.T) {
	assert.Equal(t, DefaultRetentionDays, NormalizeRetentionDays(0))
	assert.Equal(t, MaxRetentionDays, NormalizeRetentionDays(99999))
	assert.Equal(t, 7, NormalizeRetentionDays(7))
	assert.Equal(t, DefaultDir(), NormalizeDir("  "))
	assert.Equal(t, "/tmp/mssh-logs", NormalizeDir(" /tmp/mssh-logs "))
}

func TestValidateDir(t *testing.T) {
	got, err := ValidateDir("")
	require.NoError(t, err)
	assert.Equal(t, DefaultDir(), got)

	got, err = ValidateDir(" /var/log/mssh ")
	require.NoError(t, err)
	assert.Equal(t, "/var/log/mssh", got)

	_, err = ValidateDir("a" + string(rune(0)) + "b")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "NUL")

	_, err = ValidateDir(".")
	require.Error(t, err)
	_, err = ValidateDir("..")
	require.Error(t, err)

	buf := make([]byte, 4100)
	for i := range buf {
		buf[i] = 'a'
	}
	_, err = ValidateDir("/" + string(buf))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "too long")
}

func TestConfigureRejectsInvalidDir(t *testing.T) {
	manager := New(Options{})
	t.Cleanup(func() { _ = manager.Close() })
	err := manager.Configure("bad"+string(rune(0))+"dir", 7)
	require.Error(t, err)
}

func TestManagerWriteCreatesDailyFile(t *testing.T) {
	dir := t.TempDir()
	manager := New(Options{Dir: dir, RetentionDays: 30, Now: func() time.Time {
		return time.Date(2026, 7, 15, 8, 0, 0, 0, time.UTC)
	}})
	t.Cleanup(func() { _ = manager.Close() })
	require.NoError(t, manager.Configure(dir, 30))
	_, err := manager.Write([]byte("via-handler-path\n"))
	require.NoError(t, err)
	content, err := os.ReadFile(filepath.Join(dir, "2026-07-15.log"))
	require.NoError(t, err)
	assert.Contains(t, string(content), "via-handler-path")
	assert.Equal(t, dir, manager.Dir())
	assert.Equal(t, 30, manager.RetentionDays())
}

func TestManagerHandlerWritesStructuredLog(t *testing.T) {
	dir := t.TempDir()
	manager := New(Options{Dir: dir, RetentionDays: 7, Now: func() time.Time {
		return time.Date(2026, 7, 15, 9, 0, 0, 0, time.Local)
	}})
	t.Cleanup(func() { _ = manager.Close() })
	require.NoError(t, manager.Configure(dir, 7))

	logger := slog.New(manager.Handler())
	logger.Info("handler-path", "k", "v")
	content, err := os.ReadFile(filepath.Join(dir, "2026-07-15.log"))
	require.NoError(t, err)
	assert.Contains(t, string(content), "handler-path")
}

func TestDefaultDirUsesHome(t *testing.T) {
	dir := DefaultDir()
	assert.NotEmpty(t, dir)
	assert.Contains(t, dir, "logs")
}

func TestWriteReopensOnDayChange(t *testing.T) {
	dir := t.TempDir()
	day := time.Date(2026, 7, 15, 23, 0, 0, 0, time.Local)
	manager := New(Options{Dir: dir, RetentionDays: 2, Now: func() time.Time { return day }})
	t.Cleanup(func() { _ = manager.Close() })
	require.NoError(t, manager.Configure(dir, 2))
	_, err := manager.Write([]byte("day1\n"))
	require.NoError(t, err)
	day = time.Date(2026, 7, 16, 1, 0, 0, 0, time.Local)
	_, err = manager.Write([]byte("day2\n"))
	require.NoError(t, err)
	_, err = os.Stat(filepath.Join(dir, "2026-07-15.log"))
	assert.NoError(t, err)
	_, err = os.Stat(filepath.Join(dir, "2026-07-16.log"))
	assert.NoError(t, err)
}

func TestNewUsesDefaultsWhenOptionsEmpty(t *testing.T) {
	manager := New(Options{})
	assert.NotNil(t, manager)
	assert.Equal(t, DefaultRetentionDays, manager.RetentionDays())
}
