package fsutil

import (
	"errors"
	"fmt"
	"os"
)

// OpenRegularFileForAppend opens an existing regular file for atomic append writes.
func OpenRegularFileForAppend(path string) (*os.File, os.FileInfo, error) {
	expected, err := os.Lstat(path)
	if err != nil {
		return nil, nil, fmt.Errorf("inspect regular append file: %w", err)
	}
	if !expected.Mode().IsRegular() {
		return nil, nil, errors.New("path is not a regular file")
	}
	file, err := openRegularFileAppendPath(path, false, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("open regular append file: %w", err)
	}
	return finishRegularFile(file, expected)
}

// CreateRegularFileForAppend creates a new private regular file for append writes.
func CreateRegularFileForAppend(path string, permission os.FileMode) (*os.File, os.FileInfo, error) {
	file, err := openRegularFileAppendPath(path, true, permission)
	if err != nil {
		return nil, nil, fmt.Errorf("create regular append file: %w", err)
	}
	return finishRegularFile(file, nil)
}

func finishRegularFile(file *os.File, expected os.FileInfo) (*os.File, os.FileInfo, error) {
	actual, err := file.Stat()
	if err != nil {
		return nil, nil, closeRegularFileWithError(file, fmt.Errorf("inspect opened regular file: %w", err))
	}
	if !actual.Mode().IsRegular() {
		return nil, nil, closeRegularFileWithError(file, errors.New("opened path is not a regular file"))
	}
	if expected != nil && !os.SameFile(expected, actual) {
		return nil, nil, closeRegularFileWithError(file, errors.New("regular file changed while opening"))
	}
	if err := restoreRegularFileBlocking(file); err != nil {
		return nil, nil, closeRegularFileWithError(file, fmt.Errorf("restore regular file blocking mode: %w", err))
	}
	return file, actual, nil
}
