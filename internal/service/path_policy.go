package service

import (
	"fmt"
	"path/filepath"
	"strings"
)

// validateLocalTransferPath normalizes a local filesystem path used for upload/download.
// Empty paths and NUL bytes are rejected; the result is cleaned for stable storage/logging.
func validateLocalTransferPath(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", fmt.Errorf("local path is required")
	}
	if strings.ContainsRune(trimmed, 0) {
		return "", fmt.Errorf("local path contains NUL")
	}
	cleaned := filepath.Clean(trimmed)
	if cleaned == "." || cleaned == string(filepath.Separator) {
		return "", fmt.Errorf("local path is invalid")
	}
	return cleaned, nil
}

func validateRemotePath(path string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("remote path is required")
	}
	if strings.ContainsRune(path, 0) {
		return fmt.Errorf("remote path contains NUL")
	}
	return nil
}

// validateLocalFilePath rejects empty/NUL local paths for import/export surfaces.
func validateLocalFilePath(path string) (string, error) {
	return validateLocalTransferPath(path)
}
