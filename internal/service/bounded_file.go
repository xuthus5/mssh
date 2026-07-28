package service

import (
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/xuthus5/mssh/internal/fsutil"
)

type boundedRegularFile interface {
	io.Reader
	Close() error
}

func readBoundedRegularFile(path, label string, maxBytes int64) ([]byte, error) {
	content, _, err := readBoundedRegularFileWithInfo(path, label, maxBytes)
	return content, err
}

func readBoundedRegularFileWithInfo(path, label string, maxBytes int64) ([]byte, os.FileInfo, error) {
	file, info, err := openBoundedRegularFileWithInfo(path, label, maxBytes)
	if err != nil {
		return nil, nil, err
	}
	return finishBoundedRegularFileRead(file, info, label, maxBytes)
}

func finishBoundedRegularFileRead(
	file boundedRegularFile, info os.FileInfo, label string, maxBytes int64,
) ([]byte, os.FileInfo, error) {
	content, readErr := io.ReadAll(io.LimitReader(file, maxBytes+1))
	closeErr := file.Close()
	if readErr != nil || closeErr != nil {
		return nil, nil, fmt.Errorf("read %s: %w", label, errors.Join(readErr, closeErr))
	}
	if int64(len(content)) > maxBytes {
		return nil, nil, fmt.Errorf("%s exceeds %d bytes", label, maxBytes)
	}
	return content, info, nil
}

func openBoundedRegularFile(path, label string, maxBytes int64) (*os.File, error) {
	file, _, err := openBoundedRegularFileWithInfo(path, label, maxBytes)
	return file, err
}

func openBoundedRegularFileWithInfo(path, label string, maxBytes int64) (*os.File, os.FileInfo, error) {
	file, info, err := fsutil.OpenRegularFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("open %s: %w", label, err)
	}
	if info.Size() > maxBytes {
		return nil, nil, closeBoundedFileWithError(file, fmt.Errorf("%s exceeds %d bytes", label, maxBytes))
	}
	return file, info, nil
}

func closeBoundedFileWithError(file *os.File, err error) error {
	if closeErr := file.Close(); closeErr != nil {
		return errors.Join(err, closeErr)
	}
	return err
}
