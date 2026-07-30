//go:build windows

package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows"
)

func TestAIAgentWindowsProcessLifecycleKillsDescendants(t *testing.T) {
	testBinary, err := os.Executable()
	require.NoError(t, err)
	pidPath := filepath.Join(t.TempDir(), "child.pid")
	ctx, cancel := context.WithCancel(context.Background())
	command := exec.Command(testBinary, "-test.run=^TestAIAgentWindowsProcessTreeHelper$")
	command.Env = append(os.Environ(), "MSSH_AGENT_PROCESS_TREE=parent", "MSSH_AGENT_CHILD_PID_PATH="+pidPath)
	command, lifecycle, err := commandWithContext(ctx, command)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, lifecycle.Close()) })
	require.NoError(t, command.Start())
	require.NoError(t, lifecycle.Started(command))
	childPID := waitForAIAgentChildPID(t, pidPath)
	child, err := windows.OpenProcess(windows.SYNCHRONIZE, false, childPID)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, windows.CloseHandle(child)) })
	cancel()
	assert.Error(t, command.Wait())
	status, err := windows.WaitForSingleObject(child, 5000)
	require.NoError(t, err)
	assert.Equal(t, uint32(windows.WAIT_OBJECT_0), status)
}

func TestAIAgentWindowsProcessTreeHelper(t *testing.T) {
	switch os.Getenv("MSSH_AGENT_PROCESS_TREE") {
	case "":
		return
	case "parent":
		startAIAgentWindowsChild()
		time.Sleep(time.Minute)
	case "child":
		time.Sleep(time.Minute)
	default:
		os.Exit(2)
	}
}

func startAIAgentWindowsChild() {
	child := exec.Command(os.Args[0], "-test.run=^TestAIAgentWindowsProcessTreeHelper$")
	child.Env = append(os.Environ(), "MSSH_AGENT_PROCESS_TREE=child")
	if err := child.Start(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(3)
	}
	pid := []byte(strconv.Itoa(child.Process.Pid))
	if err := os.WriteFile(os.Getenv("MSSH_AGENT_CHILD_PID_PATH"), pid, 0o600); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(4)
	}
}

func waitForAIAgentChildPID(t *testing.T, path string) uint32 {
	t.Helper()
	var pid uint64
	require.Eventually(t, func() bool {
		data, err := os.ReadFile(path)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				t.Logf("read child PID: %v", err)
			}
			return false
		}
		pid, err = strconv.ParseUint(string(data), 10, 32)
		return err == nil
	}, 5*time.Second, 10*time.Millisecond)
	return uint32(pid)
}
