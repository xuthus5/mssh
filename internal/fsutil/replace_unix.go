//go:build !windows

package fsutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type replaceFileOperation struct {
	source        string
	target        string
	replace       func(string, string) error
	syncDirectory func(string) error
}

func ReplaceFile(source, target string) error {
	return executeReplaceFile(replaceFileOperation{
		source: source, target: target, replace: os.Rename, syncDirectory: syncDirectory,
	})
}

func executeReplaceFile(operation replaceFileOperation) error {
	if err := operation.replace(operation.source, operation.target); err != nil {
		return err
	}
	if err := operation.syncDirectory(filepath.Dir(operation.target)); err != nil {
		return fmt.Errorf("sync replacement directory: %w", err)
	}
	return nil
}

func syncDirectory(path string) error {
	// #nosec G304 -- path is the directory of the atomic replacement target and is opened only for fsync.
	directory, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open directory: %w", err)
	}
	syncErr := syncDirectoryFile(directory)
	closeErr := directory.Close()
	if syncErr != nil {
		syncErr = fmt.Errorf("sync directory: %w", syncErr)
	}
	if closeErr != nil {
		closeErr = fmt.Errorf("close directory: %w", closeErr)
	}
	return errors.Join(syncErr, closeErr)
}
