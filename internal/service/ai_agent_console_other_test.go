//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package service

import (
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHideAIAgentConsoleWindowIsNoopOutsideWindows(t *testing.T) {
	command := exec.Command("sh")

	hideAIAgentConsoleWindow(command)

	assert.Nil(t, command.SysProcAttr)
}
