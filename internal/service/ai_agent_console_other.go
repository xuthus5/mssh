//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package service

import "os/exec"

// hideAIAgentConsoleWindow is a no-op outside Windows, where helper processes
// do not open a separate console window.
func hideAIAgentConsoleWindow(_ *exec.Cmd) {}
