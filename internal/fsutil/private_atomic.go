package fsutil

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type privateAtomicFile interface {
	Name() string
	Chmod(os.FileMode) error
	Write([]byte) (int, error)
	Sync() error
	Close() error
}

type privateAtomicFileOperations struct {
	createTemp func(string, string) (privateAtomicFile, error)
	replace    func(string, string) error
	remove     func(string) error
}

type privateAtomicWriteOptions struct {
	pattern    string
	operations privateAtomicFileOperations
}

// WritePrivateFileAtomic writes a private file through a same-directory temporary file and atomic replacement.
func WritePrivateFileAtomic(path string, content []byte, pattern string) error {
	return writePrivateFileAtomicWithOperations(path, content, privateAtomicWriteOptions{pattern: pattern})
}

func writePrivateFileAtomicWithOperations(path string, content []byte, options privateAtomicWriteOptions) error {
	operations := options.operations.withDefaults()
	temporary, err := operations.createTemp(filepath.Dir(path), options.pattern)
	if err != nil {
		return fmt.Errorf("create atomic temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	if temporaryPath == "" {
		return closeUnnamedAtomicTemporary(temporary)
	}
	writeErr := writePrivateAtomicTemporary(temporary, content)
	closeErr := temporary.Close()
	if closeErr != nil {
		closeErr = fmt.Errorf("close atomic temporary file: %w", closeErr)
	}
	if err := errors.Join(writeErr, closeErr); err != nil {
		return cleanupAtomicTemporary(temporaryPath, err, operations.remove)
	}
	if err := operations.replace(temporaryPath, path); err != nil {
		return cleanupAtomicTemporary(temporaryPath, fmt.Errorf("replace atomic file: %w", err), operations.remove)
	}
	return nil
}

func (operations privateAtomicFileOperations) withDefaults() privateAtomicFileOperations {
	if operations.createTemp == nil {
		operations.createTemp = func(dir, pattern string) (privateAtomicFile, error) {
			return os.CreateTemp(dir, pattern)
		}
	}
	if operations.replace == nil {
		operations.replace = ReplaceFile
	}
	if operations.remove == nil {
		operations.remove = os.Remove
	}
	return operations
}

func writePrivateAtomicTemporary(file privateAtomicFile, content []byte) error {
	if err := file.Chmod(0o600); err != nil {
		return fmt.Errorf("secure atomic temporary file: %w", err)
	}
	written, err := file.Write(content)
	if err != nil {
		return fmt.Errorf("write atomic temporary file: %w", err)
	}
	if written != len(content) {
		return io.ErrShortWrite
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync atomic temporary file: %w", err)
	}
	return nil
}

func cleanupAtomicTemporary(path string, cause error, remove func(string) error) error {
	removeErr := remove(path)
	if errors.Is(removeErr, os.ErrNotExist) {
		removeErr = nil
	}
	if removeErr != nil {
		removeErr = fmt.Errorf("remove atomic temporary file: %w", removeErr)
	}
	return errors.Join(cause, removeErr)
}

func closeUnnamedAtomicTemporary(file privateAtomicFile) error {
	cause := errors.New("atomic temporary file path is empty")
	if err := file.Close(); err != nil {
		return errors.Join(cause, fmt.Errorf("close atomic temporary file: %w", err))
	}
	return cause
}
