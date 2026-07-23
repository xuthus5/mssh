package localshell

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// readEtcShells loads permitted login shells from /etc/shells when present.
// Returns nil when the file is missing (caller falls back to built-in defaults).
func readEtcShells(path string) []string {
	file, err := os.Open(path) //nolint:gosec // fixed system path or test-provided path
	if err != nil {
		return nil
	}
	defer func() { _ = file.Close() }()

	var shells []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Some distributions may list relative entries; require absolute paths.
		if !filepath.IsAbs(line) {
			continue
		}
		shells = append(shells, filepath.Clean(line))
	}
	if err := scanner.Err(); err != nil {
		return nil
	}
	return shells
}

func defaultAllowedShells() []string {
	if runtime.GOOS == "windows" {
		systemRoot := strings.TrimSpace(os.Getenv("SystemRoot"))
		if systemRoot == "" {
			systemRoot = `C:\Windows`
		}
		return []string{
			filepath.Clean(filepath.Join(systemRoot, "System32", "cmd.exe")),
			filepath.Clean(filepath.Join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")),
			filepath.Clean(filepath.Join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "pwsh.exe")),
		}
	}
	return []string{
		"/bin/sh", "/bin/bash", "/bin/zsh", "/bin/dash", "/bin/ksh", "/bin/fish",
		"/usr/bin/sh", "/usr/bin/bash", "/usr/bin/zsh", "/usr/bin/dash", "/usr/bin/ksh", "/usr/bin/fish",
		"/usr/local/bin/bash", "/usr/local/bin/zsh", "/usr/local/bin/fish",
	}
}

func allowedShellSet() map[string]struct{} {
	set := make(map[string]struct{})
	for _, shell := range defaultAllowedShells() {
		set[shell] = struct{}{}
	}
	if runtime.GOOS != "windows" {
		for _, shell := range readEtcShells("/etc/shells") {
			set[shell] = struct{}{}
		}
	}
	return set
}

func ensureShellAllowed(shell string) error {
	shell = filepath.Clean(shell)
	if runtime.GOOS == "windows" {
		// Compare case-insensitively for Windows executables.
		upper := strings.ToUpper(shell)
		for candidate := range allowedShellSet() {
			if strings.ToUpper(candidate) == upper {
				return nil
			}
		}
		// Also accept ComSpec / resolved PowerShell under SystemRoot even if not in static list.
		if comspec := strings.TrimSpace(os.Getenv("ComSpec")); comspec != "" {
			if strings.EqualFold(filepath.Clean(comspec), shell) {
				return nil
			}
		}
		return fmt.Errorf("local shell is not in the allowed shell list: %s", shell)
	}
	if _, ok := allowedShellSet()[shell]; ok {
		return nil
	}
	return fmt.Errorf("local shell is not in the allowed shell list: %s", shell)
}
