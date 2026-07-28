package ssh

import (
	"errors"
	"fmt"
	"os"
)

func inspectUploadSource(file *os.File) (*os.File, os.FileInfo, error) {
	info, err := file.Stat()
	if err != nil {
		return nil, nil, closeRejectedLocalFile(file, fmt.Errorf("stat local upload source: %w", err))
	}
	if !info.Mode().IsRegular() {
		return nil, nil, closeRejectedLocalFile(file, fmt.Errorf("upload source must be a regular file"))
	}
	return file, info, nil
}

func openDownloadTarget(path string, exclusive bool) (*os.File, error) {
	flags := os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	if exclusive {
		flags |= os.O_EXCL
	}
	// #nosec G304 -- destination is explicitly user-selected; exclusive mode rejects pre-existing links.
	file, err := os.OpenFile(path, flags, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open local download target: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		return nil, closeRejectedLocalFile(file, fmt.Errorf("secure local download target: %w", err))
	}
	info, err := file.Stat()
	if err != nil {
		return nil, closeRejectedLocalFile(file, fmt.Errorf("stat local download target: %w", err))
	}
	if !info.Mode().IsRegular() {
		return nil, closeRejectedLocalFile(file, fmt.Errorf("download target must be a regular file"))
	}
	return file, nil
}

func closeRejectedLocalFile(file *os.File, cause error) error {
	if closeErr := file.Close(); closeErr != nil {
		return errors.Join(cause, fmt.Errorf("close rejected local file: %w", closeErr))
	}
	return cause
}
