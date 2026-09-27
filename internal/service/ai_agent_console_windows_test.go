//go:build windows

package service

import (
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"golang.org/x/sys/windows"
)

func TestHideAIAgentConsoleWindowSetsCreateNoWindow(t *testing.T) {
	command := exec.Command("cmd")

	hideAIAgentConsoleWindow(command)

	assert.NotNil(t, command.SysProcAttr)
	assert.NotZero(t, command.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW)
}

func TestHideAIAgentConsoleWindowPreservesExistingFlags(t *testing.T) {
	command := exec.Command("cmd")
	command.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_SUSPENDED}

	hideAIAgentConsoleWindow(command)

	assert.NotZero(t, command.SysProcAttr.CreationFlags&windows.CREATE_SUSPENDED)
	assert.NotZero(t, command.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW)
}
