package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxSSHAgentSocketPathBytes = 4096

func resolveSSHAgentEndpoint(socketPath string) (string, string, error) {
	if strings.TrimSpace(socketPath) == "" {
		return "", "", fmt.Errorf("SSH_AUTH_SOCK not set")
	}
	if len(socketPath) > maxSSHAgentSocketPathBytes {
		return "", "", fmt.Errorf("SSH_AUTH_SOCK path is too long")
	}
	if strings.ContainsAny(socketPath, "\x00\r\n") {
		return "", "", fmt.Errorf("SSH_AUTH_SOCK path contains control characters")
	}
	if !filepath.IsAbs(socketPath) {
		return "", "", fmt.Errorf("SSH_AUTH_SOCK path must be absolute")
	}
	resolvedPath, err := filepath.EvalSymlinks(filepath.Clean(socketPath))
	if err != nil {
		return "", "", fmt.Errorf("resolve SSH_AUTH_SOCK: %w", err)
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return "", "", fmt.Errorf("stat SSH_AUTH_SOCK: %w", err)
	}
	if info.Mode()&os.ModeSocket == 0 {
		return "", "", fmt.Errorf("SSH_AUTH_SOCK is not a Unix socket")
	}
	return "unix", resolvedPath, nil
}
