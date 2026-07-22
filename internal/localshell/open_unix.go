//go:build !windows

package localshell

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/creack/pty"
)

func openPlatform(cfg resolvedConfig) (*Session, error) {
	cmd := exec.Command(cfg.Shell, cfg.Args...)
	cmd.Dir = cfg.CWD
	cmd.Env = cfg.Env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	size := &pty.Winsize{Cols: uint16(cfg.Cols), Rows: uint16(cfg.Rows)}
	ptmx, err := pty.StartWithSize(cmd, size)
	if err != nil {
		return nil, fmt.Errorf("start local shell: %w", err)
	}
	session := &Session{
		pty: ptmx,
		processWait: func() error {
			return cmd.Wait()
		},
		resizeFn: func(cols, rows int) error {
			return pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
		},
		closeFn: func() error {
			return signalLocalProcessGroup(cmd, ptmx)
		},
	}
	return session, nil
}

func signalLocalProcessGroup(cmd *exec.Cmd, ptmx *os.File) error {
	if cmd.Process != nil {
		// Signal the whole session/process group started with Setsid.
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGHUP)
	}
	closeErr := ptmx.Close()
	if cmd.Process == nil {
		return closeErr
	}
	// Give the shell a brief chance to exit before hard-killing the group.
	// Wait remains owned by processWait/waitLoop to avoid double-wait races.
	deadline := time.Now().Add(400 * time.Millisecond)
	for time.Now().Before(deadline) {
		if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
			return closeErr
		}
		time.Sleep(40 * time.Millisecond)
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	_ = cmd.Process.Kill()
	return closeErr
}
