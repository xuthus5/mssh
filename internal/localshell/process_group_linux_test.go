//go:build linux

package localshell

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLocalSessionProcessExitCleansRemainingProcessGroup(t *testing.T) {
	processFile := filepath.Join(t.TempDir(), "processes")
	readyFile := filepath.Join(t.TempDir(), "ready")
	script := `/bin/sh -c 'trap "" HUP TERM INT QUIT; : > "$1"; while :; do sleep 1; done' mssh "$2" & while [ ! -e "$2" ]; do sleep 0.01; done; printf '%s %s\n' "$$" "$!" > "$1"; exit 0`
	session, err := Open(Options{
		Shell: "/bin/sh", Args: []string{"-c", script, "mssh-test", processFile, readyFile}, Cols: 80, Rows: 24,
	})
	require.NoError(t, err)
	exited := make(chan error, 1)
	session.SetExitCallback(func(exitErr error) { exited <- exitErr })
	session.Start()
	processGroupID, _ := waitLocalProcessIDs(t, processFile)
	t.Cleanup(func() {
		_ = syscall.Kill(-processGroupID, syscall.SIGKILL)
		_ = session.Close()
	})

	select {
	case exitErr := <-exited:
		require.NoError(t, exitErr)
	case <-time.After(3 * time.Second):
		t.Fatal("local shell exit callback timed out")
	}

	require.Eventually(t, func() bool {
		return !localProcessGroupRunning(processGroupID)
	}, time.Second, 20*time.Millisecond, "background process remained after shell exit")
}

func waitLocalProcessIDs(t *testing.T, path string) (int, int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		content, err := os.ReadFile(path)
		if err == nil {
			fields := strings.Fields(string(content))
			if len(fields) == 2 {
				processGroupID, groupErr := strconv.Atoi(fields[0])
				childPID, childErr := strconv.Atoi(fields[1])
				if groupErr == nil && childErr == nil {
					return processGroupID, childPID
				}
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("local shell did not publish process IDs")
	return 0, 0
}

func localProcessGroupRunning(processGroupID int) bool {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if _, err := strconv.Atoi(entry.Name()); err != nil {
			continue
		}
		content, readErr := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if readErr != nil {
			continue
		}
		end := strings.LastIndexByte(string(content), ')')
		if end < 0 {
			continue
		}
		fields := strings.Fields(string(content[end+1:]))
		group, parseErr := strconv.Atoi(fields[2])
		if parseErr == nil && group == processGroupID && fields[0] != "Z" {
			return true
		}
	}
	return false
}
