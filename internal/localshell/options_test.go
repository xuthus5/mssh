package localshell

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveOptionsDefaults(t *testing.T) {
	cfg, err := resolveOptions(Options{})
	require.NoError(t, err)
	assert.NotEmpty(t, cfg.Shell)
	assert.Equal(t, 80, cfg.Cols)
	assert.Equal(t, 24, cfg.Rows)
	assert.Equal(t, "xterm-256color", cfg.Term)
	assert.Contains(t, cfg.Env, "TERM=xterm-256color")
}

func TestResolveOptionsInvalidCWD(t *testing.T) {
	_, err := resolveOptions(Options{CWD: t.TempDir() + "/missing-dir"})
	require.Error(t, err)
}

func TestParseArgs(t *testing.T) {
	assert.Nil(t, ParseArgs("  "))
	assert.Equal(t, []string{"-l", "--norc"}, ParseArgs(" -l  --norc "))
}

func TestLoginArgUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("login argv0 only for unix shells")
	}
	cfg, err := resolveOptions(Options{Shell: "/bin/bash", Login: true})
	require.NoError(t, err)
	require.NotEmpty(t, cfg.Args)
	assert.Equal(t, "-l", cfg.Args[0])
}

func TestExpandPathHome(t *testing.T) {
	home, err := os.UserHomeDir()
	require.NoError(t, err)
	cfg, err := resolveOptions(Options{CWD: "~"})
	require.NoError(t, err)
	assert.Equal(t, home, cfg.CWD)
}

func TestResolveOptionsInvalidShell(t *testing.T) {
	_, err := resolveOptions(Options{Shell: t.TempDir() + "/missing-shell"})
	require.Error(t, err)
}

func TestResolveShellRejectsNonExecutable(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "not-shell")
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/sh\n"), 0o600))
	_, err := resolveShell(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not executable")
}
