package applog

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagerConfigureSwitchesDirectoryOnSameDay(t *testing.T) {
	firstDir := t.TempDir()
	secondDir := t.TempDir()
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.Local)
	manager := New(Options{Dir: firstDir, RetentionDays: 30, Now: func() time.Time { return now }})
	t.Cleanup(func() { _ = manager.Close() })

	require.NoError(t, manager.Configure(firstDir, 30))
	_, err := manager.Write([]byte("first-directory\n"))
	require.NoError(t, err)
	require.NoError(t, manager.Configure(secondDir, 14))
	_, err = manager.Write([]byte("second-directory\n"))
	require.NoError(t, err)

	firstContent, err := os.ReadFile(filepath.Join(firstDir, "2026-07-27.log"))
	require.NoError(t, err)
	secondContent, err := os.ReadFile(filepath.Join(secondDir, "2026-07-27.log"))
	require.NoError(t, err)
	assert.Contains(t, string(firstContent), "first-directory")
	assert.NotContains(t, string(firstContent), "second-directory")
	assert.Contains(t, string(secondContent), "second-directory")
	assert.Equal(t, secondDir, manager.Dir())
	assert.Equal(t, 14, manager.RetentionDays())
}

func TestManagerConfigureFailureKeepsActiveDestination(t *testing.T) {
	activeDir := t.TempDir()
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.Local)
	manager := New(Options{Dir: activeDir, RetentionDays: 9, Now: func() time.Time { return now }})
	t.Cleanup(func() { _ = manager.Close() })
	require.NoError(t, manager.Configure(activeDir, 9))

	notDirectory := filepath.Join(t.TempDir(), "not-a-directory")
	require.NoError(t, os.WriteFile(notDirectory, []byte("sentinel"), 0o600))
	err := manager.Configure(notDirectory, 14)
	require.Error(t, err)
	assert.Equal(t, activeDir, manager.Dir())
	assert.Equal(t, 9, manager.RetentionDays())

	_, err = manager.Write([]byte("still-active\n"))
	require.NoError(t, err)
	content, err := os.ReadFile(filepath.Join(activeDir, "2026-07-27.log"))
	require.NoError(t, err)
	assert.Contains(t, string(content), "still-active")
}

func TestManagerConfigureCloseFailureKeepsPreviousConfiguration(t *testing.T) {
	activeDir := t.TempDir()
	nextDir := t.TempDir()
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.Local)
	manager := New(Options{Dir: activeDir, RetentionDays: 9, Now: func() time.Time { return now }})
	t.Cleanup(func() { _ = manager.Close() })
	require.NoError(t, manager.Configure(activeDir, 9))
	require.NoError(t, manager.file.Close())

	err := manager.Configure(nextDir, 14)
	require.Error(t, err)
	assert.Equal(t, activeDir, manager.Dir())
	assert.Equal(t, 9, manager.RetentionDays())

	_, err = manager.Write([]byte("reopened-previous\n"))
	require.NoError(t, err)
	content, err := os.ReadFile(filepath.Join(activeDir, "2026-07-27.log"))
	require.NoError(t, err)
	assert.Contains(t, string(content), "reopened-previous")
	nextContent, err := os.ReadFile(filepath.Join(nextDir, "2026-07-27.log"))
	require.NoError(t, err)
	assert.Empty(t, nextContent)
}

func TestManagerConfigurePreservesExistingDirectoryPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("directory mode semantics differ on Windows")
	}
	dir := t.TempDir()
	require.NoError(t, os.Chmod(dir, 0o755))
	manager := New(Options{})
	t.Cleanup(func() { _ = manager.Close() })

	require.NoError(t, manager.Configure(dir, 30))
	info, err := os.Stat(dir)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o755), info.Mode().Perm())
}

func TestManagerConfigureCreatesPrivateDirectoryAndFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("permission bits differ on Windows")
	}
	dir := filepath.Join(t.TempDir(), "private-logs")
	manager := New(Options{Now: func() time.Time {
		return time.Date(2026, 7, 27, 12, 0, 0, 0, time.Local)
	}})
	t.Cleanup(func() { _ = manager.Close() })

	require.NoError(t, manager.Configure(dir, 30))
	dirInfo, err := os.Stat(dir)
	require.NoError(t, err)
	fileInfo, err := os.Stat(filepath.Join(dir, "2026-07-27.log"))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o700), dirInfo.Mode().Perm())
	assert.Equal(t, os.FileMode(0o600), fileInfo.Mode().Perm())
}

func TestManagerConfigureRejectsSymlinkDailyFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	dir := t.TempDir()
	sentinel := filepath.Join(t.TempDir(), "sentinel.log")
	require.NoError(t, os.WriteFile(sentinel, []byte("must-survive"), 0o600))
	logPath := filepath.Join(dir, "2026-07-27.log")
	if err := os.Symlink(sentinel, logPath); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	manager := New(Options{Now: func() time.Time {
		return time.Date(2026, 7, 27, 12, 0, 0, 0, time.Local)
	}})
	t.Cleanup(func() { _ = manager.Close() })

	err := manager.Configure(dir, 30)
	require.Error(t, err)
	content, readErr := os.ReadFile(sentinel)
	require.NoError(t, readErr)
	assert.Equal(t, []byte("must-survive"), content)
}

func TestManagerReportsMaintenanceFailureToStderr(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("removing an open log directory differs on Windows")
	}
	dir := t.TempDir()
	var stderr bytes.Buffer
	manager := New(Options{Dir: dir, RetentionDays: 30, Stderr: &stderr})
	require.NoError(t, manager.Configure(dir, 30))
	require.NoError(t, manager.Close())
	require.NoError(t, os.RemoveAll(dir))

	manager.mu.Lock()
	manager.purgeLocked()
	manager.mu.Unlock()

	assert.Contains(t, stderr.String(), "application log maintenance failed")
	assert.Contains(t, stderr.String(), "read log directory")
}

func TestManagerSerializesConcurrentWritesAndReconfiguration(t *testing.T) {
	firstDir := t.TempDir()
	secondDir := t.TempDir()
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.Local)
	manager := New(Options{Now: func() time.Time { return now }})
	t.Cleanup(func() { _ = manager.Close() })
	require.NoError(t, manager.Configure(firstDir, 30))

	const writerCount = 4
	const writesPerWorker = 50
	errorsFound := make(chan error, writerCount*writesPerWorker+20)
	var workers sync.WaitGroup
	for worker := 0; worker < writerCount; worker++ {
		workers.Add(1)
		go func(workerID int) {
			for writeIndex := 0; writeIndex < writesPerWorker; writeIndex++ {
				_, err := manager.Write([]byte(fmt.Sprintf("worker-%d-%d\n", workerID, writeIndex)))
				if err != nil {
					errorsFound <- err
				}
			}
			workers.Done()
		}(worker)
	}
	workers.Add(1)
	go func() {
		for index := 0; index < 20; index++ {
			dir := firstDir
			if index%2 == 1 {
				dir = secondDir
			}
			if err := manager.Configure(dir, 30); err != nil {
				errorsFound <- err
			}
		}
		workers.Done()
	}()
	workers.Wait()
	close(errorsFound)
	for err := range errorsFound {
		assert.NoError(t, err)
	}
}
