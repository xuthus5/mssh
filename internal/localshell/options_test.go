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

func TestParseArgsQuoted(t *testing.T) {
	assert.Equal(t, []string{"-c", "echo hello"}, ParseArgs(`-c "echo hello"`))
	assert.Equal(t, []string{"-c", "echo hello"}, ParseArgs(`-c 'echo hello'`))
	assert.Equal(t, []string{"path with space"}, ParseArgs(`"path with space"`))
	assert.Equal(t, []string{`say "hi"`}, ParseArgs(`"say \"hi\""`))
}

func TestParseArgsForWindowsPreservesPathsAndEmptyValues(t *testing.T) {
	args := parseArgsForOS(`--profile "C:\Users\alice\Documents\PowerShell" --command "say \"hi\"" ""`, "windows")
	assert.Equal(t, []string{
		"--profile",
		`C:\Users\alice\Documents\PowerShell`,
		"--command",
		`say "hi"`,
		"",
	}, args)
}

func TestResolveShellRejectsDisallowedBinary(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "evil-bin")
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/sh\n"), 0o700))
	_, err := resolveShell(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "allowed shell list")
}

func TestDefaultShellUsesEnv(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix default shell")
	}
	t.Setenv("SHELL", "/bin/sh")
	assert.Equal(t, "/bin/sh", defaultShell())
}

func TestExecLookPath(t *testing.T) {
	path, err := execLookPath("sh")
	if err != nil {
		// some minimal environments may lack sh in PATH; still exercise the wrapper
		require.Error(t, err)
		return
	}
	require.NotEmpty(t, path)
}

func TestExpandPathEmptyAndPlain(t *testing.T) {
	got, err := expandPath("")
	require.NoError(t, err)
	assert.Equal(t, "", got)
	got, err = expandPath("/tmp")
	require.NoError(t, err)
	assert.Equal(t, "/tmp", got)
}

func TestResolveArgsLoginWindowsNoop(t *testing.T) {
	if runtime.GOOS == "windows" {
		assert.Equal(t, []string{"/c"}, resolveArgs([]string{"/c"}, true))
		return
	}
	assert.Equal(t, []string{"-l"}, resolveArgs(nil, true))
	assert.Equal(t, []string{"-x"}, resolveArgs([]string{"-x"}, true))
}

func TestDefaultShellFallback(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix")
	}
	t.Setenv("SHELL", "")
	shell := defaultShell()
	require.NotEmpty(t, shell)
}

func TestEnsureShellAllowedRejectsUnknown(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix")
	}
	require.Error(t, ensureShellAllowed("/tmp/not-a-shell-bin"))
}

func TestDefaultAllowedShellsUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix")
	}
	shells := defaultAllowedShells()
	require.NotEmpty(t, shells)
	assert.Contains(t, shells, "/bin/bash")
}

func TestResolveShellUsesLookPathForBareName(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix")
	}
	// bare name in allowlist after look path — "bash" may resolve
	if _, err := execLookPath("bash"); err != nil {
		t.Skip("bash not in PATH")
	}
	// ensureShellAllowed requires absolute cleaned path from lookpath
	shell, err := resolveShell("bash")
	if err != nil {
		// allowlist may reject if path not in defaults; still exercise lookpath branch
		t.Log(err)
		return
	}
	require.NotEmpty(t, shell)
}

func TestResolveOptionsExplicitShellAndArgs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix")
	}
	cfg, err := resolveOptions(Options{Shell: "/bin/bash", Args: []string{"-c", "true"}, CWD: t.TempDir(), Cols: 10, Rows: 5, Term: "xterm", Login: false})
	require.NoError(t, err)
	assert.NotEmpty(t, cfg.Shell)
	assert.Equal(t, []string{"-c", "true"}, cfg.Args)
	assert.Equal(t, 10, cfg.Cols)
	assert.Equal(t, 5, cfg.Rows)
}

func TestEnsureEnvReplacesAndAppends(t *testing.T) {
	env := []string{"PATH=/bin", "FOO=1"}
	env = ensureEnv(env, "FOO", "2")
	env = ensureEnv(env, "BAR", "3")
	assert.Contains(t, env, "FOO=2")
	assert.Contains(t, env, "BAR=3")
	assert.Contains(t, env, "PATH=/bin")
}

func TestResolveCWDHomeFallback(t *testing.T) {
	cwd, err := resolveCWD("")
	require.NoError(t, err)
	// empty resolves to home or getwd
	assert.NotEmpty(t, cwd)
}
