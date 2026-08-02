package service

import "github.com/xuthus5/mssh/internal/localshell"

// ListLocalShellCandidates returns the shell paths that actually exist on the
// local machine, deduplicated and ordered deterministically. Used by the
// settings UI to offer preset options for the local terminal shell.
func (t *TerminalService) ListLocalShellCandidates() []string {
	return localshell.ListShellCandidates()
}
