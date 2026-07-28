package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func validateRecordingPaths(paths []string, recordingsDir string) error {
	root, err := filepath.Abs(filepath.Clean(recordingsDir))
	if err != nil {
		return fmt.Errorf("resolve recording directory: %w", err)
	}
	rootInfo, rootErr := os.Lstat(root)
	if rootErr != nil && !errors.Is(rootErr, os.ErrNotExist) {
		return fmt.Errorf("stat recording directory: %w", rootErr)
	}
	if rootErr == nil && (rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir()) {
		return fmt.Errorf("recording directory is not a real directory")
	}
	var resolvedRoot string
	if rootErr == nil {
		resolvedRoot, err = filepath.EvalSymlinks(root)
		if err != nil {
			return fmt.Errorf("resolve recording directory: %w", err)
		}
	}
	for _, path := range paths {
		if err := validateRecordingPath(path, root, resolvedRoot, rootErr != nil); err != nil {
			return err
		}
	}
	return nil
}

func validateRecordingPath(path, root, resolvedRoot string, rootMissing bool) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("recording path is empty")
	}
	absPath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return fmt.Errorf("resolve recording path: %w", err)
	}
	if !pathWithinDirectory(root, absPath) {
		return fmt.Errorf("recording path outside recordings directory")
	}
	info, statErr := os.Lstat(absPath)
	if errors.Is(statErr, os.ErrNotExist) {
		if rootMissing {
			return nil
		}
		return validateRecordingParent(absPath, resolvedRoot)
	}
	if statErr != nil {
		return fmt.Errorf("stat recording path: %w", statErr)
	}
	if info.IsDir() {
		return fmt.Errorf("recording path is a directory")
	}
	resolvedPath, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		return fmt.Errorf("resolve recording path: %w", err)
	}
	resolvedPath, err = filepath.Abs(resolvedPath)
	if err != nil {
		return fmt.Errorf("resolve recording path: %w", err)
	}
	if !pathWithinDirectory(resolvedRoot, resolvedPath) {
		return fmt.Errorf("recording path outside recordings directory")
	}
	return nil
}

func validateRecordingParent(path, resolvedRoot string) error {
	parent, err := filepath.Abs(filepath.Dir(path))
	if err != nil {
		return fmt.Errorf("resolve recording parent: %w", err)
	}
	resolvedParent, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return fmt.Errorf("resolve recording parent: %w", err)
	}
	resolvedParent, err = filepath.Abs(resolvedParent)
	if err != nil {
		return fmt.Errorf("resolve recording parent: %w", err)
	}
	if !pathWithinDirectory(resolvedRoot, resolvedParent) {
		return fmt.Errorf("recording path outside recordings directory")
	}
	return nil
}

func pathWithinDirectory(directory, path string) bool {
	relative, err := filepath.Rel(directory, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func removeRecordingFile(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove %q: %w", path, err)
	}
	return nil
}
