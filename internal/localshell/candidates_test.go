package localshell

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProbeShellRejectsMissingAndDirectories(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	missing := filepath.Join(dir, "missing")
	_, ok := probeShell(missing)
	assert.False(t, ok)
	_, ok = probeShell(dir)
	assert.False(t, ok)
	replacement := filepath.Join(dir, "shell")
	require.NoError(t, os.WriteFile(replacement, []byte("#!/bin/sh\n"), 0o600))
	if runtime.GOOS == "windows" {
		// Windows treats the file as existing and ignores the executable bit.
		resolved, ok := probeShell(replacement)
		assert.True(t, ok)
		assert.Equal(t, filepath.Clean(replacement), resolved)
	} else {
		_, ok = probeShell(replacement)
		assert.True(t, ok, "existing file without exec bit still passes on unix (bit check only used for allowlist)")
	}
}

func TestProbeShellCrossPlatformExecutableBit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("executable-bit semantics only apply on unix")
	}
	t.Parallel()
	shell := filepath.Join(t.TempDir(), "exec")
	require.NoError(t, os.WriteFile(shell, []byte("#!/bin/sh\n"), 0o700))
	resolved, ok := probeShell(shell)
	require.True(t, ok)
	assert.Equal(t, filepath.Clean(shell), resolved)
}

func TestAppendUniqueShell(t *testing.T) {
	t.Parallel()
	seen := make(map[string]struct{})
	values := appendUniqueShell(nil, seen, "/bin/bash")
	values = appendUniqueShell(values, seen, "/bin/bash")
	values = appendUniqueShell(values, seen, "/usr/bin/zsh")
	assert.Equal(t, []string{"/bin/bash", "/usr/bin/zsh"}, values)
}

func TestListShellCandidatesBuildsResult(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix-specific candidate smoke")
	}
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("/bin/sh missing")
	}
	got := ListShellCandidates()
	assert.Contains(t, got, "/bin/sh")
	assert.Equal(t, got, dedupeAssertPreserveOrder(t, got))
}

func TestListShellCandidatesDeduplicates(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix candidate source specific")
	}
	got := ListShellCandidates()
	assert.Equal(t, got, dedupeAssertPreserveOrder(t, got))
}

func dedupeAssertPreserveOrder(t *testing.T, values []string) []string {
	t.Helper()
	seen := make(map[string]struct{})
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
