package fsutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// OpenRegularFile opens an existing regular file without following symlinks.
func OpenRegularFile(path string) (*os.File, os.FileInfo, error) {
	return openRegularFile(path)
}

// OpenRegularFileFollowingSymlinks resolves symlinks before safely opening the final regular file.
func OpenRegularFileFollowingSymlinks(path string) (*os.File, os.FileInfo, error) {
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve regular file: %w", err)
	}
	return openRegularFile(resolvedPath)
}

func openRegularFile(path string) (*os.File, os.FileInfo, error) {
	expected, err := os.Lstat(path)
	if err != nil {
		return nil, nil, fmt.Errorf("inspect regular file: %w", err)
	}
	if !expected.Mode().IsRegular() {
		return nil, nil, errors.New("path is not a regular file")
	}
	file, err := openRegularFilePath(path)
	if err != nil {
		return nil, nil, fmt.Errorf("open regular file: %w", err)
	}
	return finishRegularFile(file, expected)
}

func closeRegularFileWithError(file *os.File, cause error) error {
	if err := file.Close(); err != nil {
		return errors.Join(cause, fmt.Errorf("close rejected regular file: %w", err))
	}
	return cause
}
