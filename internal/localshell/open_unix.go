//go:build !windows

package localshell

import (
	"fmt"
	"os/exec"
	"syscall"

	"github.com/creack/pty"
)

func openPlatform(cfg resolvedConfig) (*Session, error) {
	cmd := exec.Command(cfg.Shell, cfg.Args...)
	cmd.Dir = cfg.CWD
	cmd.Env = cfg.Env
	cmd.SysProcAttr = &syscall.SysProcAttr{}
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
			if cmd.Process != nil {
				_ = cmd.Process.Signal(syscall.SIGHUP)
			}
			err := ptmx.Close()
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			return err
		},
	}
	return session, nil
}
