package service

import "os/exec"

type aiAgentProcessLifecycle interface {
	Started(command *exec.Cmd) error
	Cancel(command *exec.Cmd) error
	Close() error
}
