package localshell

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Options configures a local shell session.
type Options struct {
	Shell string
	Args  []string
	CWD   string
	Login bool
	Cols  int
	Rows  int
	Term  string
	Env   []string
}

type resolvedConfig struct {
	Shell string
	Args  []string
	CWD   string
	Login bool
	Cols  int
	Rows  int
	Term  string
	Env   []string
}

func resolveOptions(opts Options) (resolvedConfig, error) {
	shell, err := resolveShell(opts.Shell)
	if err != nil {
		return resolvedConfig{}, err
	}
	cwd, err := resolveCWD(opts.CWD)
	if err != nil {
		return resolvedConfig{}, err
	}
	cols, rows := normalizeSize(opts.Cols, opts.Rows)
	term := strings.TrimSpace(opts.Term)
	if term == "" {
		term = "xterm-256color"
	}
	args := resolveArgs(opts.Args, opts.Login)
	env := opts.Env
	if env == nil {
		env = os.Environ()
	}
	env = ensureEnv(env, "TERM", term)
	env = ensureEnv(env, "COLORTERM", "truecolor")
	return resolvedConfig{
		Shell: shell,
		Args:  args,
		CWD:   cwd,
		Login: opts.Login,
		Cols:  cols,
		Rows:  rows,
		Term:  term,
		Env:   env,
	}, nil
}

func resolveShell(raw string) (string, error) {
	shell := strings.TrimSpace(raw)
	if shell == "" {
		shell = defaultShell()
	}
	if shell == "" {
		return "", fmt.Errorf("unable to resolve local shell path")
	}
	return shell, nil
}

func resolveCWD(raw string) (string, error) {
	cwd, err := expandPath(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	if cwd == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr == nil && home != "" {
			cwd = home
		} else {
			cwd, _ = os.Getwd()
		}
	}
	if cwd == "" {
		return cwd, nil
	}
	info, err := os.Stat(cwd)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("local shell working directory is invalid: %s", cwd)
	}
	return cwd, nil
}

func normalizeSize(cols, rows int) (int, int) {
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	return cols, rows
}

func resolveArgs(args []string, login bool) []string {
	resolved := append([]string{}, args...)
	if login && runtime.GOOS != "windows" && len(resolved) == 0 {
		// Prefer portable login flag over argv0 dash form for predictability.
		return []string{"-l"}
	}
	return resolved
}

func defaultShell() string {
	if runtime.GOOS == "windows" {
		if comspec := strings.TrimSpace(os.Getenv("ComSpec")); comspec != "" {
			return comspec
		}
		systemRoot := strings.TrimSpace(os.Getenv("SystemRoot"))
		if systemRoot == "" {
			systemRoot = `C:\Windows`
		}
		return filepath.Join(systemRoot, "System32", "cmd.exe")
	}
	if shell := strings.TrimSpace(os.Getenv("SHELL")); shell != "" {
		return shell
	}
	for _, candidate := range []string{"/bin/bash", "/bin/zsh", "/bin/sh"} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func expandPath(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~`+string(filepath.Separator)) {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		if path == "~" {
			return home, nil
		}
		return filepath.Join(home, path[2:]), nil
	}
	return path, nil
}

func ensureEnv(env []string, key, value string) []string {
	prefix := key + "="
	for i, item := range env {
		if strings.HasPrefix(item, prefix) {
			env[i] = prefix + value
			return env
		}
	}
	return append(env, prefix+value)
}

// ParseArgs splits a simple shell-args string by whitespace (no quote expansion).
func ParseArgs(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	return strings.Fields(raw)
}
