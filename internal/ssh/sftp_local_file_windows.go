//go:build windows

package ssh

import (
	"fmt"
	"os"
	"path/filepath"
)

func openUploadSource(path string) (*os.File, os.FileInfo, error) {
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve local upload source: %w", err)
	}
	// #nosec G304 -- source is explicitly user-selected and verified as a regular file after opening.
	file, err := os.Open(resolvedPath)
	if err != nil {
		return nil, nil, fmt.Errorf("open local upload source: %w", err)
	}
	return inspectUploadSource(file)
}
