package localshell

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadEtcShells(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "shells")
	content := "# comment\n\n/bin/bash\nrelative\n/usr/bin/zsh\n"
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
	got := readEtcShells(path)
	assert.Equal(t, []string{"/bin/bash", "/usr/bin/zsh"}, got)
	assert.Nil(t, readEtcShells(filepath.Join(dir, "missing")))
}

func TestEnsureShellAllowedKnown(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix allowlist sample")
	}
	// /bin/sh should always be present on unix CI images used by this project.
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("/bin/sh missing")
	}
	require.NoError(t, ensureShellAllowed("/bin/sh"))
}
