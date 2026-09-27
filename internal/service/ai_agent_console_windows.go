//go:build windows

package service

import (
	"os/exec"

	"golang.org/x/sys/windows"
)

// hideAIAgentConsoleWindow makes console-subsystem helper processes spawned by
// the GUI app run without flashing a new console window on Windows.
func hideAIAgentConsoleWindow(command *exec.Cmd) {
	if command.SysProcAttr == nil {
		command.SysProcAttr = &windows.SysProcAttr{}
	}
	command.SysProcAttr.CreationFlags |= windows.CREATE_NO_WINDOW
}
