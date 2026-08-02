package localshell

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// platformShellCandidates returns the shell paths to probe for the current
// platform, in a deterministic order. Existence is not checked here.
func platformShellCandidates() []string {
	if runtime.GOOS == "windows" {
		systemRoot := strings.TrimSpace(os.Getenv("SystemRoot"))
		if systemRoot == "" {
			systemRoot = `C:\Windows`
		}
		root := filepath.Clean(systemRoot)
		candidates := []string{
			filepath.Join(root, "System32", "cmd.exe"),
			filepath.Join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			filepath.Join(root, "System32", "WindowsPowerShell", "v1.0", "pwsh.exe"),
		}
		if comspec := strings.TrimSpace(os.Getenv("ComSpec")); comspec != "" {
			candidates = append(candidates, filepath.Clean(comspec))
		}
		return candidates
	}
	return []string{
		"/bin/sh", "/bin/bash", "/bin/zsh", "/bin/dash", "/bin/ksh", "/bin/fish",
		"/usr/bin/bash", "/usr/bin/zsh", "/usr/bin/dash", "/usr/bin/ksh", "/usr/bin/fish",
		"/usr/local/bin/bash", "/usr/local/bin/zsh", "/usr/local/bin/fish",
	}
}

// probeShell validates that path exists as a non-directory, executable shell.
func probeShell(path string) (string, bool) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return "", false
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return "", false
	}
	return filepath.Clean(path), true
}

func appendUniqueShell(candidates []string, seen map[string]struct{}, path string) []string {
	if path == "" {
		return candidates
	}
	key := path
	if runtime.GOOS == "windows" {
		key = strings.ToUpper(key)
	}
	if _, ok := seen[key]; ok {
		return candidates
	}
	seen[key] = struct{}{}
	return append(candidates, path)
}

// ListShellCandidates returns the Shell paths that actually exist on this
// machine, deduplicated and ordered deterministically. Known static paths,
// /etc/shells, and $SHELL are combined on non-Windows platforms.
func ListShellCandidates() []string {
	paths := platformShellCandidates()
	if runtime.GOOS != "windows" {
		paths = append(paths, readEtcShells("/etc/shells")...)
		if shell := strings.TrimSpace(os.Getenv("SHELL")); shell != "" {
			paths = append(paths, filepath.Clean(shell))
		}
	}
	seen := make(map[string]struct{})
	var result []string
	for _, candidate := range paths {
		resolved, ok := probeShell(candidate)
		if !ok {
			continue
		}
		result = appendUniqueShell(result, seen, resolved)
	}
	return result
}
