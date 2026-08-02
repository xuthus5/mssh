//go:build windows

package localshell

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestListShellCandidatesWindows(t *testing.T) {
	t.Parallel()
	systemRoot := strings.TrimSpace(os.Getenv("SystemRoot"))
	if systemRoot == "" {
		systemRoot = `C:\Windows`
	}
	cmdPath := filepath.Join(systemRoot, "System32", "cmd.exe")
	if _, err := os.Stat(cmdPath); err != nil {
		t.Skip("cmd.exe missing")
	}
	got := ListShellCandidates()
	require.NotEmpty(t, got)
	seen := make(map[string]struct{})
	var foundCmd bool
	for _, candidate := range got {
		key := strings.ToUpper(candidate)
		if _, ok := seen[key]; ok {
			t.Fatalf("duplicate candidate %s", candidate)
		}
		seen[key] = struct{}{}
		if strings.EqualFold(candidate, cmdPath) {
			foundCmd = true
		}
	}
	require.True(t, foundCmd, "cmd.exe should be present in candidates")
}
