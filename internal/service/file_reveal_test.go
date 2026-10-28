package service

import (
	"database/sql"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func newRevealTestService(t *testing.T, reveal func(string) error) (*FileService, *sql.DB) {
	t.Helper()
	db := testutil.NewTestDB(t)
	service := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger(),
		WithTransferDB(db), withFileTransferOperations(fileTransferOperations{revealLocal: reveal}))
	return service, db
}

func seedRevealJob(t *testing.T, db *sql.DB, job model.TransferJob) {
	t.Helper()
	job.StartedAt = time.Now()
	require.NoError(t, store.CreateTransferJob(db, job))
}

func TestRevealTransferShowsCompletedDownload(t *testing.T) {
	target := filepath.Join(t.TempDir(), "archive.zip")
	require.NoError(t, os.WriteFile(target, []byte("payload"), 0o600))
	var revealed string
	service, db := newRevealTestService(t, func(path string) error {
		revealed = path
		return nil
	})
	seedRevealJob(t, db, model.TransferJob{
		ID: "download", SessionID: 1, SessionName: "server", Direction: "download",
		SourcePath: "/remote/archive.zip", TargetPath: target, Status: "completed",
	})

	require.NoError(t, service.RevealTransfer("download"))
	assert.Equal(t, target, revealed)
}

func TestRevealTransferRejectsUnsupportedJobs(t *testing.T) {
	testCases := []struct {
		name      string
		direction string
		status    string
		message   string
	}{
		{name: "upload", direction: "upload", status: "completed", message: "only downloaded files"},
		{name: "running", direction: "download", status: "running", message: "is not completed"},
		{name: "failed", direction: "download", status: "failed", message: "is not completed"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			service, db := newRevealTestService(t, func(string) error { return nil })
			seedRevealJob(t, db, model.TransferJob{
				ID: testCase.name, SessionID: 1, SessionName: "server", Direction: testCase.direction,
				SourcePath: "/remote/file", TargetPath: filepath.Join(t.TempDir(), "file"), Status: testCase.status,
			})
			require.ErrorContains(t, service.RevealTransfer(testCase.name), testCase.message)
		})
	}
}

func TestRevealTransferValidatesTarget(t *testing.T) {
	directory := t.TempDir()
	missing := filepath.Join(directory, "missing")
	testCases := []struct {
		name    string
		target  string
		message string
	}{
		{name: "empty", target: "", message: "local path is required"},
		{name: "relative", target: "relative.txt", message: "must be absolute"},
		{name: "missing", target: missing, message: "does not exist"},
		{name: "directory", target: directory, message: "regular file"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			service, db := newRevealTestService(t, func(string) error { return nil })
			seedRevealJob(t, db, model.TransferJob{
				ID: testCase.name, SessionID: 1, SessionName: "server", Direction: "download",
				SourcePath: "/remote/file", TargetPath: testCase.target, Status: "completed",
			})
			require.ErrorContains(t, service.RevealTransfer(testCase.name), testCase.message)
		})
	}
}

func TestRevealTransferRejectsInvalidRequests(t *testing.T) {
	serviceWithoutDB := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())
	require.ErrorContains(t, serviceWithoutDB.RevealTransfer(""), "invalid task id")
	require.ErrorContains(t, serviceWithoutDB.RevealTransfer("task"), "database unavailable")

	service, db := newRevealTestService(t, func(string) error { return nil })
	require.Error(t, service.RevealTransfer("missing"))

	service.mu.Lock()
	service.stopping = true
	service.mu.Unlock()
	require.ErrorContains(t, service.RevealTransfer("missing"), "shutting down")

	service, db = newRevealTestService(t, func(string) error { return errors.New("launcher missing") })
	target := filepath.Join(t.TempDir(), "file.txt")
	require.NoError(t, os.WriteFile(target, []byte("payload"), 0o600))
	seedRevealJob(t, db, model.TransferJob{
		ID: "launch-failure", SessionID: 1, SessionName: "server", Direction: "download",
		SourcePath: "/remote/file.txt", TargetPath: target, Status: "completed",
	})
	require.ErrorContains(t, service.RevealTransfer("launch-failure"), "launcher missing")
}

func TestRevealFileCommands(t *testing.T) {
	path := "/tmp/report #1.txt"
	testCases := []struct {
		goos       string
		name       string
		args       []string
		ignoreExit bool
	}{
		{goos: "windows", name: "explorer.exe", args: []string{"/select," + path}, ignoreExit: true},
		{goos: "darwin", name: "open", args: []string{"-R", path}},
	}
	for _, testCase := range testCases {
		t.Run(testCase.goos, func(t *testing.T) {
			commands, err := revealFileCommands(testCase.goos, path)
			require.NoError(t, err)
			require.Len(t, commands, 1)
			assert.Equal(t, testCase.name, commands[0].name)
			assert.Equal(t, testCase.args, commands[0].args)
			assert.Equal(t, testCase.ignoreExit, commands[0].ignoreExitError)
		})
	}

	commands, err := revealFileCommands("linux", path)
	require.NoError(t, err)
	require.Len(t, commands, 2)
	assert.Equal(t, "dbus-send", commands[0].name)
	assert.Contains(t, commands[0].args, "array:string:file:///tmp/report%20%231.txt")
	assert.Equal(t, revealCommand{name: "xdg-open", args: []string{"/tmp"}}, commands[1])

	_, err = revealFileCommands("plan9", path)
	require.ErrorContains(t, err, "unsupported")
}

func TestRevealFileInManagerFallbackAndErrors(t *testing.T) {
	path := "/tmp/file.txt"
	var attempted []string
	runner := func(name string, _ []string) error {
		attempted = append(attempted, name)
		if name == "dbus-send" {
			return errors.New("bus unavailable")
		}
		return nil
	}
	require.NoError(t, revealFileInManagerWith("linux", path, runner))
	assert.Equal(t, []string{"dbus-send", "xdg-open"}, attempted)

	require.Error(t, revealFileInManagerWith("linux", path, func(string, []string) error {
		return errors.New("launch failed")
	}))
	require.Error(t, revealFileInManagerWith("plan9", path, runner))
}

func TestRevealFileInManagerIgnoresWindowsExitStatus(t *testing.T) {
	exitErr := exec.Command("sh", "-c", "exit 7").Run()
	require.Error(t, exitErr)
	require.NoError(t, revealFileInManagerWith("windows", `C:\tmp\file.txt`, func(string, []string) error {
		return exitErr
	}))
	require.Error(t, revealFileInManagerWith("windows", `C:\tmp\file.txt`, func(string, []string) error {
		return errors.New("start failed")
	}))
}

func TestRunRevealCommand(t *testing.T) {
	require.NoError(t, runRevealCommand("sh", []string{"-c", "exit 0"}))
	require.Error(t, runRevealCommand("sh", []string{"-c", "exit 1"}))
	require.Error(t, runRevealCommand("mssh-command-that-does-not-exist", nil))
}

func TestRevealLocalFileSurfacesLaunchFailure(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PATH-based command lookup differs on Windows")
	}
	t.Setenv("PATH", "")
	require.Error(t, revealLocalFile(filepath.Join(t.TempDir(), "file.txt")))
}
