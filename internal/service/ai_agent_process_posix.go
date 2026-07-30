//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package service

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

type posixAIAgentProcessLifecycle struct{}

func newAIAgentProcessLifecycle(command *exec.Cmd) (aiAgentProcessLifecycle, error) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return posixAIAgentProcessLifecycle{}, nil
}

func (posixAIAgentProcessLifecycle) Started(_ *exec.Cmd) error { return nil }

func (posixAIAgentProcessLifecycle) Cancel(command *exec.Cmd) error {
	if command.Process == nil {
		return os.ErrProcessDone
	}
	err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return os.ErrProcessDone
	}
	return err
}

func (posixAIAgentProcessLifecycle) Close() error { return nil }
