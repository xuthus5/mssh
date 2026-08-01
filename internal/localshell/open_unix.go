//go:build !windows

package localshell

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/creack/pty"
)

func openPlatformContext(ctx context.Context, cfg resolvedConfig) (*Session, error) {
	// 本地 shell 的生命周期长于绑定调用本身：Wails 会在方法返回后立即取消调用
	// context，若直接绑定该 context，进程会被 exec.CommandContext 立刻 SIGKILL。
	// WithoutCancel 保留启动期 ctx.Err() 的取消语义，但不再跟随调用结束而杀进程。
	cmd := exec.CommandContext(context.WithoutCancel(ctx), cfg.Shell, cfg.Args...)
	cmd.Dir = cfg.CWD
	cmd.Env = cfg.Env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	size := ptySize(cfg.Cols, cfg.Rows)
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
			return pty.Setsize(ptmx, ptySize(cols, rows))
		},
		closeFn: func() error {
			return signalLocalProcessGroup(cmd, ptmx)
		},
	}
	return session, nil
}

func ptySize(cols, rows int) *pty.Winsize {
	return &pty.Winsize{
		Cols: uint16(cols), // #nosec G115 -- validateSize bounds dimensions to uint16.
		Rows: uint16(rows), // #nosec G115 -- validateSize bounds dimensions to uint16.
	}
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
	// Give the entire process group a brief chance to exit before hard-killing it.
	// Wait remains owned by processWait/waitLoop to avoid double-wait races.
	deadline := time.Now().Add(400 * time.Millisecond)
	for time.Now().Before(deadline) {
		if !localProcessGroupAlive(cmd.Process.Pid) {
			return closeErr
		}
		time.Sleep(40 * time.Millisecond)
	}
	killErr := forceKillLocalProcessGroup(cmd.Process.Pid, syscall.Kill, cmd.Process.Kill)
	return errors.Join(closeErr, killErr)
}

func localProcessGroupAlive(processGroupID int) bool {
	err := syscall.Kill(-processGroupID, syscall.Signal(0))
	return err == nil || errors.Is(err, syscall.EPERM)
}

func forceKillLocalProcessGroup(
	processGroupID int,
	killGroup func(int, syscall.Signal) error,
	killProcess func() error,
) error {
	groupErr := killGroup(-processGroupID, syscall.SIGKILL)
	if processAlreadyStopped(groupErr) {
		return nil
	}
	processErr := killProcess()
	groupErr = fmt.Errorf("force kill local process group: %w", groupErr)
	if processAlreadyStopped(processErr) {
		return groupErr
	}
	return errors.Join(groupErr, fmt.Errorf("force kill local shell process: %w", processErr))
}

func processAlreadyStopped(err error) bool {
	return err == nil || errors.Is(err, syscall.ESRCH) || errors.Is(err, os.ErrProcessDone)
}
